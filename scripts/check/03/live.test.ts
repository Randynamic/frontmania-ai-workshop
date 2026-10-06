import { describe, expect, test } from 'vitest';
import { BackendError, BackendUnreachableError } from '../../../src/backend/client.js';
import type { LastRun } from '../../../src/run/record.js';
import type { FoundTrace } from '../trace.js';
import {
  completeRows,
  FEEDBACK_WAIT_MS,
  liveChecks03,
  toolOrderFromTrace,
  type FeedbackRow,
} from './live.js';

const lastAgent: LastRun = {
  traceId: 'tr-plan',
  kind: 'agent',
  tokens: 900,
  latencyMs: 4000,
  recordedAt: '2026-10-07T10:10:00.000Z',
  toolCalls: ['getTimetable', 'searchArchive'],
};
const row = (slot: string, attachedAt: number | null = 1): FeedbackRow => ({
  slot,
  thumb: 'up',
  reason: 'fits',
  attachedAt,
});
const three = [row('14:15'), row('15:30'), row('16:30')];
const span = (name: string, startMs: number) => ({
  name,
  startMs,
  endMs: startMs + 5,
  input: null,
  output: null,
  attributes: {},
});
const trace: FoundTrace = {
  found: true,
  tokens: 900,
  latencyMs: 4000,
  spans: [
    span("tool: 'searchArchive'", 20),
    span("agent run: 'planner-agent'", 0),
    span("tool: 'getTimetable'", 10),
  ],
};

/** A fake clock: every sleep advances time, so the waits finish instantly. */
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};

describe('check:03 live layer', () => {
  test('passes with three attached rows and prints the tool order from the trace', async () => {
    // Act
    const lines = await liveChecks03({
      lastAgent,
      fetchFeedback: async () => three,
      fetchTrace: async () => trace,
      ...clock(),
    });

    // Assert
    expect(lines.map((l) => l.status)).toEqual(['OK', 'OK', 'OK', 'OK', 'OK']);
    expect(lines[1]!.detail).toBe('14:15 up "fits" | 15:30 up "fits" | 16:30 up "fits"');
    expect(lines[4]).toMatchObject({
      name: 'tool-call order (trace)',
      detail: 'getTimetable -> searchArchive',
    });
  });

  test('waits for attachment, then fails with the retry hint', async () => {
    const progress: string[] = [];
    let fetches = 0;
    const lines = await liveChecks03({
      lastAgent,
      fetchFeedback: async () => {
        fetches += 1;
        return [row('14:15', null), row('15:30'), row('16:30')];
      },
      fetchTrace: async () => ({ ...trace, spans: [] }),
      progress: (line) => progress.push(line),
      ...clock(),
    });
    expect(fetches).toBeGreaterThan(1);
    expect(progress).toContain('waiting for MLflow to attach the 3 feedback rows on tr-plan ...');
    const attached = lines.find((l) => l.name === 'feedback attached to MLflow');
    expect(attached).toMatchObject({ status: 'FAIL' });
    expect(attached?.detail).toContain(`${FEEDBACK_WAIT_MS / 1000} s`);
    expect(lines.at(-1)).toMatchObject({
      name: 'tool-call order (last-agent.json)',
      detail: 'getTimetable -> searchArchive',
    });
  });

  test('fewer than three rows fail with step 3 after one fetch, without waiting', async () => {
    // Arrange
    let fetches = 0;
    const progress: string[] = [];

    // Act
    const lines = await liveChecks03({
      lastAgent: { ...lastAgent, toolCalls: undefined },
      fetchFeedback: async () => {
        fetches += 1;
        return [row('14:15', null)];
      },
      fetchTrace: async () => trace,
      progress: (line) => progress.push(line),
      ...clock(),
    });

    // Assert
    expect(fetches).toBe(1);
    expect(progress).toEqual([]);
    expect(lines[1]).toMatchObject({
      status: 'FAIL',
      detail:
        'feedback rows: 1, expected 3 with distinct slots; run `pnpm ask` again and answer all three (step 3)',
    });
  });

  test('feedback and trace waits run side by side within one 20 s budget', async () => {
    // Arrange: rows never attach and the trace never arrives
    const fake = clock();

    // Act
    await liveChecks03({
      lastAgent,
      fetchFeedback: async () => [row('14:15', null), row('15:30'), row('16:30')],
      fetchTrace: async () => ({ found: false }),
      ...fake,
    });

    // Assert: both deadlines are 20 s from the same start, plus at most one poll
    expect(FEEDBACK_WAIT_MS).toBe(20_000);
    expect(fake.now()).toBeLessThanOrEqual(FEEDBACK_WAIT_MS + 3_000);
  });

  test('an unreachable backend is BLOCKED, a backend error is FAIL', async () => {
    const blockedLines = await liveChecks03({
      lastAgent,
      fetchFeedback: async () => {
        throw new BackendUnreachableError('/api/feedback', 'ECONNREFUSED');
      },
      fetchTrace: async () => trace,
      ...clock(),
    });
    expect(blockedLines[1]).toMatchObject({ status: 'BLOCKED' });
    const failLines = await liveChecks03({
      lastAgent,
      fetchFeedback: async () => {
        throw new BackendError(404, '/api/feedback', 'traceId is not one of your runs');
      },
      fetchTrace: async () => trace,
      ...clock(),
    });
    expect(failLines[1]).toMatchObject({ status: 'FAIL' });
  });

  test('helpers', () => {
    expect(completeRows(three)).toBe(true);
    expect(completeRows([...three.slice(0, 2), { ...row('16:30'), reason: ' ' }])).toBe(false);
    expect(toolOrderFromTrace(trace)).toEqual(['getTimetable', 'searchArchive']);
  });
});
