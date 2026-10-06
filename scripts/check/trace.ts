import { z } from 'zod';
import { BackendError, BackendUnreachableError } from '../../src/backend/client.js';
import { blocked, fail, ok, type CheckLine } from './lib.js';

/**
 * Shared by the live layers of check:02 and check:03: the backend's trace
 * view and the polling wait for a batched export. Same numbers as
 * check:01's own copy (scripts/check/01/live.ts), which stays untouched.
 */
export const TRACE_WAIT_MS = 20_000;
export const TRACE_POLL_MS = 2_000;
/** The backend itself blocks up to TRACE_WAIT_MS per request; a longer client timeout turns a slow ingestion into FAIL, not BLOCKED. */
export const TRACE_CLIENT_TIMEOUT_MS = TRACE_WAIT_MS + 5_000;

export const TraceSpan = z.object({
  name: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  input: z.unknown(),
  output: z.unknown(),
  attributes: z.record(z.string(), z.unknown()),
});
export type TraceSpan = z.infer<typeof TraceSpan>;

export const TraceResponse = z.union([
  z.object({
    found: z.literal(true),
    tokens: z.number().nullable(),
    latencyMs: z.number().nullable(),
    spans: z.array(TraceSpan),
  }),
  z.object({ found: z.literal(false), error: z.string().optional() }),
]);
export type TraceResponse = z.infer<typeof TraceResponse>;
export type FoundTrace = Extract<TraceResponse, { found: true }>;

export interface TraceWaitDeps {
  /** One request to GET /api/traces/:traceId; throws BackendError or BackendUnreachableError. */
  readonly fetchTrace: (traceId: string) => Promise<TraceResponse>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly progress?: (line: string) => void;
}

/** Polls the backend until the trace is there, the deadline passes (FAIL) or the backend is unreachable (BLOCKED). */
export const waitForTrace = async (
  traceId: string,
  deps: TraceWaitDeps,
): Promise<{ readonly line: CheckLine; readonly trace?: FoundTrace }> => {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const progress = deps.progress ?? (() => undefined);
  const deadline = now() + TRACE_WAIT_MS;
  const attempt = async (): Promise<{ readonly line: CheckLine; readonly trace?: FoundTrace }> => {
    try {
      const response = await deps.fetchTrace(traceId);
      if (response.found)
        return { line: ok('trace found at the backend', traceId), trace: response };
      if (now() >= deadline) {
        return {
          line: fail(
            'trace found at the backend',
            `${traceId} not ingested within ${TRACE_WAIT_MS / 1000} s; the exporter batches, run the check again`,
          ),
        };
      }
      progress(`waiting for trace ${traceId} ...`);
      await sleep(TRACE_POLL_MS);
      return attempt();
    } catch (error) {
      if (error instanceof BackendUnreachableError) {
        return {
          line: blocked('trace found at the backend', error.message),
        };
      }
      if (error instanceof BackendError)
        return { line: fail('trace found at the backend', error.message) };
      throw error;
    }
  };
  return attempt();
};
