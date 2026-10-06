import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { gitIn, publishIndex, requireIndexMatches, requireLiveManifest } from './publish-index.js';

const LIVE_MANIFEST = {
  index: 'archive',
  dimension: 1536,
  embedding: 'talk-picker-embed',
  mode: 'live',
  fixture: false,
  rows: 30,
  years: [2025],
  builtAt: '2026-10-06T08:00:00.000Z',
};

describe('requireLiveManifest', () => {
  test('returns the manifest for a live build', () => {
    expect(requireLiveManifest(JSON.stringify(LIVE_MANIFEST)).dimension).toBe(1536);
  });

  test('refuses a mock build', () => {
    const mock = { ...LIVE_MANIFEST, mode: 'mock', embedding: 'mock-hash-v1', dimension: 256 };
    expect(() => requireLiveManifest(JSON.stringify(mock))).toThrow(/MODEL_MODE=live/);
  });

  test('refuses a manifest that breaks the schema', () => {
    expect(() => requireLiveManifest(JSON.stringify({ mode: 'live' }))).toThrow(/schema/);
  });
});

describe('requireIndexMatches', () => {
  const manifest = requireLiveManifest(JSON.stringify(LIVE_MANIFEST));

  test('accepts an index that agrees with the manifest', () => {
    expect(() => requireIndexMatches(manifest, { dimension: 1536, count: 30 })).not.toThrow();
  });

  test('refuses a dimension or row mismatch', () => {
    expect(() => requireIndexMatches(manifest, { dimension: 256, count: 30 })).toThrow(
      /dimension 256/,
    );
    expect(() => requireIndexMatches(manifest, { dimension: 1536, count: 29 })).toThrow(/29 rows/);
  });
});

describe('publishIndex', () => {
  let repo: string;
  const run = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const write = (path: string, text: string): void => writeFileSync(join(repo, path), text);

  beforeEach(() => {
    // Arrange: a merge-derived pair of branches with the old (mock) index on both
    repo = mkdtempSync(join(tmpdir(), 'publish-index-repo-'));
    run('init', '-q', '-b', '00-setup');
    run('config', 'user.email', 'test@example.org');
    run('config', 'user.name', 'test');
    mkdirSync(join(repo, 'data'));
    write('data/archive.db', 'mock-db');
    write('data/archive-manifest.json', '{"mode":"mock"}');
    write('app.ts', 'setup');
    run('add', '.');
    run('commit', '-q', '-m', 'setup');
    run('tag', 'checkpoint/00-setup');
    run('checkout', '-q', '-b', '01-start');
    write('app.ts', 'start');
    run('commit', '-q', '-am', 'start');
    run('tag', 'checkpoint/01-start');
    write('data/archive.db', 'live-db');
    write('data/archive-manifest.json', '{"mode":"live"}');
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test('commits the working-tree index on every branch and moves the tags', () => {
    // Act
    const results = publishIndex(gitIn(repo), {
      branches: ['00-setup', '01-start'],
      message: 'data: live index',
    });

    // Assert
    expect(results.every((r) => !r.isUnchanged)).toBe(true);
    ['00-setup', '01-start'].forEach((branch) => {
      expect(run('show', `${branch}:data/archive.db`)).toBe('live-db');
      expect(run('rev-parse', `checkpoint/${branch}^{commit}`)).toBe(run('rev-parse', branch));
      expect(run('rev-parse', `${branch}~1`)).toBe(results.find((r) => r.branch === branch)?.from);
    });
    expect(run('show', '01-start:app.ts')).toBe('start');
    expect(run('show', '00-setup:app.ts')).toBe('setup');
    expect(run('status', '--porcelain')).toBe('');
  });

  test('is a no-op on a second run', () => {
    publishIndex(gitIn(repo), { branches: ['00-setup', '01-start'], message: 'm' });
    const second = publishIndex(gitIn(repo), { branches: ['00-setup', '01-start'], message: 'm' });
    expect(second.every((r) => r.isUnchanged)).toBe(true);
  });
});
