import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { backendConfigFrom } from '../backend/client.js';
import { clearCurrentRun, getCurrentRun } from '../feedback/current-run.js';
import { lastRunPath, readLastRun, registerRun, writeLastRun } from './record.js';

afterEach(() => clearCurrentRun());

const tempDir = () => mkdtempSync(join(tmpdir(), 'talk-picker-run-'));

describe('registerRun', () => {
  test('posts the tr- id and kind, then sets the current run', async () => {
    const bodies: unknown[] = [];
    const config = backendConfigFrom(
      { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
      {
        fetchImpl: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return new Response('{"ok":true}', { status: 200 });
        },
      },
    );
    const run = await registerRun('446ae47eb395812155265a4e51014e75', 'plan', { config });
    expect(run).toEqual({ traceId: 'tr-446ae47eb395812155265a4e51014e75', kind: 'plan' });
    expect(bodies[0]).toEqual({ traceId: 'tr-446ae47eb395812155265a4e51014e75', kind: 'plan' });
    expect(getCurrentRun()).toEqual(run);
  });

  test('a backend refusal leaves no current run', async () => {
    const config = backendConfigFrom(
      { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
      { fetchImpl: async () => new Response('{"error":"unknown key"}', { status: 401 }) },
    );
    await expect(registerRun('tr-abc', 'profile', { config })).rejects.toThrow('PROXY_API_KEY');
    expect(getCurrentRun()).toBeUndefined();
  });
});

describe('last-run files', () => {
  test('writes and reads back last-<kind>.json with extra fields', () => {
    const dir = tempDir();
    const written = writeLastRun(
      'profile',
      {
        traceId: 'tr-1',
        tokens: 341,
        latencyMs: 56,
        profile: { role: 'dev' },
        recordedAt: '2026-10-07T09:20:00.000Z',
      },
      dir,
    );
    expect(written).toMatchObject({ kind: 'profile', tokens: 341, profile: { role: 'dev' } });
    expect(JSON.parse(readFileSync(lastRunPath('profile', dir), 'utf8'))).toEqual(written);
    expect(readLastRun('profile', dir)).toEqual(written);
    expect(readLastRun('plan', dir)).toBeUndefined();
  });

  test('fills recordedAt, accepts null numbers, and rejects a corrupt file', () => {
    const dir = tempDir();
    const written = writeLastRun(
      'compare',
      { traceId: 'tr-2', tokens: null, latencyMs: null },
      dir,
    );
    expect(new Date(written.recordedAt).getTime()).not.toBeNaN();
    writeFileSync(lastRunPath('ask' as 'agent', dir), '{"traceId":""}', 'utf8');
    expect(() => readLastRun('ask' as 'agent', dir)).toThrow('not a run record');
    expect(() => writeLastRun('plan', { traceId: '', tokens: 1, latencyMs: 1 }, dir)).toThrow();
  });
});
