import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { writeLastRun } from '../../src/run/record.js';
import {
  assertion,
  backendConfigOrLine,
  blocked,
  collectStrings,
  EXIT_BLOCKED,
  EXIT_FAIL,
  EXIT_OK,
  exitCodeFor,
  fail,
  formatLine,
  formatSummary,
  isMockRun,
  isStaticMode,
  lastRunOrFail,
  ok,
  printReport,
  skip,
  warn,
} from './lib.js';

describe('check reporter', () => {
  test('exit codes: FAIL beats BLOCKED beats OK; WARN never changes the exit code', () => {
    expect(exitCodeFor([ok('a')])).toBe(EXIT_OK);
    expect(exitCodeFor([ok('a'), warn('c', 'not run yet')])).toBe(EXIT_OK);
    expect(formatLine(warn('c', 'not run yet'))).toBe('WARN    c: not run yet');
    expect(exitCodeFor([ok('a'), blocked('b', 'start the stack')])).toBe(EXIT_BLOCKED);
    expect(exitCodeFor([blocked('b', 'x'), fail('c', 'missing (step 1)')])).toBe(EXIT_FAIL);
  });

  test('static mode from the flag or the env', () => {
    expect(isStaticMode(['--static'], {})).toBe(true);
    expect(isStaticMode([], { CHECK_MODE: 'static' })).toBe(true);
    expect(isStaticMode([], {})).toBe(false);
  });

  test('lines and summary are readable in a terminal', () => {
    expect(formatLine(assertion('stack bounded', false, 'accepts 11 (step 1)'))).toBe(
      'FAIL    stack bounded: accepts 11 (step 1)',
    );
    expect(formatLine(ok('marker'))).toBe('OK      marker');
    const summary = formatSummary('01', [ok('a'), fail('b', 'x')], {
      staticOnly: true,
      elapsedMs: 42,
    });
    expect(summary).toBe('check:01 failed: 1 OK, 1 FAIL, 0 BLOCKED (static layer only, 42 ms)');
    expect(
      formatSummary('01', [ok('a'), blocked('b', 'x')], { staticOnly: false, elapsedMs: 1 }),
    ).toContain('blocked (static layer passed');
  });

  test('printReport logs every line plus the summary and returns the exit code', () => {
    const logged: string[] = [];
    const code = printReport(
      '01',
      [ok('a'), blocked('b', 'x')],
      { staticOnly: false, startedAt: Date.now() },
      (l) => logged.push(l),
    );
    expect(code).toBe(EXIT_BLOCKED);
    expect(logged).toHaveLength(3);
  });

  test('lastRunOrFail names the script to run when the record is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'talk-picker-check-'));
    const missing = lastRunOrFail('profile', 'pnpm run profile', dir);
    expect('line' in missing && missing.line.detail).toContain('run `pnpm run profile` first');
    writeLastRun('profile', { traceId: 'tr-1', tokens: 1, latencyMs: 1 }, dir);
    const found = lastRunOrFail('profile', 'pnpm run profile', dir);
    expect('run' in found && found.run.traceId).toBe('tr-1');
  });

  test('collectStrings walks nested values', () => {
    expect(collectStrings({ a: ['x', { b: 'y', n: 1 }], c: null })).toEqual(['x', 'y']);
  });

  test('SKIP lines never change the exit code and are counted only when present', () => {
    const lines = [ok('a'), skip('masked', 'live layer')];
    expect(exitCodeFor(lines)).toBe(EXIT_OK);
    expect(formatLine(lines[1]!)).toBe('SKIP    masked: live layer');
    expect(formatSummary('01', lines, { staticOnly: true, elapsedMs: 5 })).toBe(
      'check:01 passed: 1 OK, 0 FAIL, 0 BLOCKED, 1 SKIP (static layer only, 5 ms)',
    );
  });

  test('isMockRun reads the recorded mode or the mock participant id', () => {
    const base = { traceId: 'tr-1', kind: 'profile' as const, tokens: 1, latencyMs: 1 };
    const recordedAt = new Date().toISOString();
    expect(isMockRun({ ...base, recordedAt, participantId: 'mock' })).toBe(true);
    expect(isMockRun({ ...base, recordedAt, mode: 'mock', participantId: 'otter-42' })).toBe(true);
    expect(isMockRun({ ...base, recordedAt, participantId: 'otter-42' })).toBe(false);
  });

  test('backendConfigOrLine: a missing key is a local config FAIL with the fix, not BLOCKED', () => {
    const missingKey = backendConfigOrLine({ WORKSHOP_BACKEND_URL: 'https://ws.test' }, 1_000);
    expect('line' in missingKey && missingKey.line).toEqual({
      status: 'FAIL',
      name: 'local config',
      detail:
        'PROXY_API_KEY missing or empty in .env; compare .env with .env.example and paste the key from your card',
    });
    const missingBoth = backendConfigOrLine({ PROXY_API_KEY: ' ' }, 1_000);
    expect('line' in missingBoth && missingBoth.line.detail).toMatch(
      /^WORKSHOP_BACKEND_URL and PROXY_API_KEY missing/,
    );
    const fine = backendConfigOrLine(
      { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
      1_000,
    );
    expect('config' in fine && fine.config.timeoutMs).toBe(1_000);
  });
});
