import { describe, expect, test } from 'vitest';
import { BackendError, BackendUnreachableError } from '../../src/backend/client.js';
import {
  TRACE_CLIENT_TIMEOUT_MS,
  TRACE_WAIT_MS,
  waitForTrace,
  type TraceResponse,
} from './trace.js';

const found: TraceResponse = { found: true, tokens: 1, latencyMs: 2, spans: [] };
const immediate = { now: () => 0, sleep: async () => undefined };

describe('waitForTrace', () => {
  test('the client timeout outlives the backend wait', () => {
    expect(TRACE_CLIENT_TIMEOUT_MS).toBeGreaterThan(TRACE_WAIT_MS);
  });

  test('polls until found, fails after the deadline, blocks when unreachable, fails on a backend error', async () => {
    let calls = 0;
    const progress: string[] = [];
    const ok = await waitForTrace('tr-1', {
      fetchTrace: async () => (++calls < 3 ? { found: false } : found),
      ...immediate,
      progress: (l) => progress.push(l),
    });
    expect(ok.line.status).toBe('OK');
    expect(ok.trace).toEqual(found);
    expect(progress).toHaveLength(2);

    let clock = 0;
    const late = await waitForTrace('tr-2', {
      fetchTrace: async () => ({ found: false }),
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(late.line.status).toBe('FAIL');
    expect(late.line.detail).toContain('run the check again');

    const down = await waitForTrace('tr-3', {
      fetchTrace: async () => {
        throw new BackendUnreachableError('/api/traces/tr-3', 'ECONNREFUSED');
      },
      ...immediate,
    });
    expect(down.line.status).toBe('BLOCKED');

    const rejected = await waitForTrace('tr-4', {
      fetchTrace: async () => {
        throw new BackendError(404, '/api/traces/tr-4', 'not one of your runs');
      },
      ...immediate,
    });
    expect(rejected.line.status).toBe('FAIL');
    await expect(
      waitForTrace('tr-5', {
        fetchTrace: async () => {
          throw new TypeError('boom');
        },
        ...immediate,
      }),
    ).rejects.toThrow('boom');
  });
});
