import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { BackendError, BackendUnreachableError } from '../../../src/backend/client.js';
import { DATA_PATHS } from '../../../src/data/paths.js';
import type { LastRun } from '../../../src/run/record.js';
import {
  liveChecks01,
  TRACE_CLIENT_TIMEOUT_MS,
  TRACE_WAIT_MS,
  type TraceResponse,
} from './live.js';

const cvPath = resolve(DATA_PATHS.cvsDir, '02-senior-react-architect.md');
const cvText = readFileSync(cvPath, 'utf8');
const HASH = 'abcdef0123456789';
const MARKER = '[cv:sha256:abcdef012345]';

const lastRun: LastRun = {
  traceId: 'tr-1',
  kind: 'profile',
  tokens: 900,
  latencyMs: 1500,
  recordedAt: '2026-10-07T09:20:00.000Z',
  profile: { role: 'dev', seniority: 'lead', stack: ['React'], interests: [], avoid: [] },
  input: { kind: 'cv', path: cvPath },
  inputHash: HASH,
};

type FoundTrace = Extract<TraceResponse, { found: true }>;

const maskedTrace = (extra = ''): FoundTrace => ({
  found: true,
  tokens: 812,
  latencyMs: 1320,
  spans: [
    {
      name: 'agent run: profile-agent',
      input: { messages: [{ role: 'user', content: `${MARKER}${extra}` }] },
      output: '{"role":"dev"}',
      attributes: { 'mastra.metadata.participantId': 'otter-42' },
    },
  ],
});

const readInput = (path: string) => (path === cvPath ? cvText : undefined);
const immediate = { now: () => 0, sleep: async () => undefined };

describe('liveChecks01', () => {
  test('the trace read outlives the backend wait, so a slow ingestion is FAIL, not BLOCKED', () => {
    expect(TRACE_CLIENT_TIMEOUT_MS).toBeGreaterThan(TRACE_WAIT_MS);
  });

  test('a masked trace passes and prints the workbook numbers from the trace', async () => {
    const lines = await liveChecks01({
      lastRun,
      fetchTrace: async () => maskedTrace(),
      readInput,
      ...immediate,
    });
    expect(lines.filter((l) => l.status !== 'OK')).toEqual([]);
    expect(lines.find((l) => l.name === 'masked')?.detail).toMatch(/^yes \(\d+ CV lines checked\)/);
    expect(lines.at(-1)?.detail).toBe('tokens: 812  latency: 1320 ms');
  });

  test('a CV line in a span output is masked: NO', async () => {
    const leaked = maskedTrace();
    const trace: TraceResponse = {
      ...leaked,
      spans: [{ ...leaked.spans[0]!, output: `${cvText.split('\n')[10]}` }],
    };
    const lines = await liveChecks01({
      lastRun,
      fetchTrace: async () => trace,
      readInput,
      ...immediate,
    });
    const masked = lines.find((l) => l.name === 'masked');
    expect(masked?.status).toBe('FAIL');
    expect(masked?.detail).toContain('NO: 1 of');
    expect(masked?.detail).not.toContain(cvText.split('\n')[10]);
  });

  test('a missing marker fails and names the processor', async () => {
    const trace = maskedTrace();
    const noMarker: TraceResponse = {
      ...trace,
      spans: [{ ...trace.spans[0]!, input: { messages: [{ content: 'nothing' }] } }],
    };
    const lines = await liveChecks01({
      lastRun,
      fetchTrace: async () => noMarker,
      readInput,
      ...immediate,
    });
    expect(lines.find((l) => l.name === 'hash marker in trace')?.detail).toContain(
      'CvMaskingProcessor',
    );
    expect(lines.find((l) => l.name === 'masked')?.detail).toBe('NO: marker missing');
  });

  test('polls until the trace is found, then fails after the deadline', async () => {
    let clock = 0;
    let calls = 0;
    const progress: string[] = [];
    const lines = await liveChecks01({
      lastRun,
      fetchTrace: async () => (++calls < 3 ? { found: false } : maskedTrace()),
      readInput,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      progress: (l) => progress.push(l),
    });
    expect(calls).toBe(3);
    expect(progress).toHaveLength(2);
    expect(lines.find((l) => l.name === 'trace found at the backend')?.status).toBe('OK');

    let late = 0;
    const timedOut = await liveChecks01({
      lastRun,
      fetchTrace: async () => ({ found: false, error: 'not ingested' }),
      readInput,
      now: () => late,
      sleep: async (ms) => {
        late += ms * 10;
      },
    });
    expect(timedOut.find((l) => l.name === 'trace found at the backend')?.detail).toContain(
      'run the check again',
    );
  });

  test('an unreachable backend is BLOCKED, a 404 is FAIL, a missing profile record is FAIL', async () => {
    const down = await liveChecks01({
      lastRun,
      fetchTrace: async () => {
        throw new BackendUnreachableError('/api/traces/tr-1', 'ECONNREFUSED');
      },
      readInput,
      ...immediate,
    });
    expect(down.find((l) => l.name === 'trace found at the backend')?.status).toBe('BLOCKED');
    const notMine = await liveChecks01({
      lastRun,
      fetchTrace: async () => {
        throw new BackendError(404, '/api/traces/tr-1', 'not one of your runs');
      },
      readInput,
      ...immediate,
    });
    expect(notMine.find((l) => l.name === 'trace found at the backend')?.status).toBe('FAIL');
    const noProfile = await liveChecks01({
      lastRun: { ...lastRun, profile: undefined },
      fetchTrace: async () => maskedTrace(),
      readInput,
      ...immediate,
    });
    expect(noProfile[0]?.status).toBe('FAIL');
  });

  test('typed skills: marker only, and the last-run numbers fill in when the trace has none', async () => {
    const skillsRun: LastRun = { ...lastRun, input: { kind: 'skills' } };
    const trace = { ...maskedTrace(), tokens: null, latencyMs: null };
    const lines = await liveChecks01({
      lastRun: skillsRun,
      fetchTrace: async () => trace,
      readInput,
      ...immediate,
    });
    expect(lines.find((l) => l.name === 'masked')?.detail).toBe('yes (typed skills, marker only)');
    expect(lines.at(-1)?.detail).toBe('tokens: 900  latency: 1500 ms');
  });
});
