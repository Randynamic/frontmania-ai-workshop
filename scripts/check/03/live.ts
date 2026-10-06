import { z } from 'zod';
import { BackendError, BackendUnreachableError } from '../../../src/backend/client.js';
import type { LastRun } from '../../../src/run/record.js';
import { SLOTS } from '../../../src/schemas/talk.js';
import { blocked, fail, ok, type CheckLine } from '../lib.js';
import { waitForTrace, type FoundTrace, type TraceWaitDeps } from '../trace.js';

/**
 * Live layer of pnpm check:03: the last `pnpm ask` run, the three feedback
 * rows on its (plan) trace at the backend, attached to MLflow by the
 * backend's worker, and the order in which the agent called its tools.
 *
 * Time budget: the feedback wait and the trace wait run side by side, each
 * capped at 20 s, so the live layer stays under the 20 s per check of
 * repo-plan 4.2 (blueprint G3). Rows that are incomplete never wait:
 * `pnpm ask` posts them during turn 2, so their count cannot grow.
 */
export const FEEDBACK_WAIT_MS = 20_000;
export const FEEDBACK_POLL_MS = 3_000;
const TOOL_SPAN = /^tool: '([^']+)'$/;

export const FeedbackRow = z.object({
  slot: z.string(),
  thumb: z.string(),
  reason: z.string(),
  attachedAt: z.number().nullable(),
});
export type FeedbackRow = z.infer<typeof FeedbackRow>;
export const FeedbackRows = z.object({ ok: z.literal(true), rows: z.array(FeedbackRow) });

const AgentRunExtras = z.object({ toolCalls: z.array(z.string()) }).partial();

export interface LiveInputs03 extends TraceWaitDeps {
  readonly lastAgent: LastRun;
  /** One request to GET /api/feedback?traceId=; throws BackendError or BackendUnreachableError. */
  readonly fetchFeedback: (traceId: string) => Promise<readonly FeedbackRow[]>;
}

/** Three rows, one per slot, each with a thumb and a reason. */
export const completeRows = (rows: readonly FeedbackRow[]): boolean => {
  const valid = rows.filter((r) => ['up', 'down'].includes(r.thumb) && r.reason.trim().length > 0);
  return valid.length === SLOTS.length && new Set(valid.map((r) => r.slot)).size === SLOTS.length;
};

const allAttached = (rows: readonly FeedbackRow[]): boolean =>
  rows.every((r) => r.attachedAt !== null);

/**
 * Returns at once when the rows are incomplete (a rerun of `pnpm ask` is the
 * only fix) or already attached; polls only while three complete rows wait
 * for the backend's worker, until the deadline. Returns the last rows seen.
 */
export const waitForFeedback = async (
  traceId: string,
  inputs: LiveInputs03,
): Promise<readonly FeedbackRow[]> => {
  const now = inputs.now ?? Date.now;
  const sleep = inputs.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const deadline = now() + FEEDBACK_WAIT_MS;
  const attempt = async (): Promise<readonly FeedbackRow[]> => {
    const rows = await inputs.fetchFeedback(traceId);
    if (!completeRows(rows) || allAttached(rows) || now() >= deadline) return rows;
    inputs.progress?.(
      `waiting for MLflow to attach the ${SLOTS.length} feedback rows on ${traceId} ...`,
    );
    await sleep(FEEDBACK_POLL_MS);
    return attempt();
  };
  return attempt();
};

const rowLine = (row: FeedbackRow): string =>
  `${row.slot} ${row.thumb} "${row.reason}"${row.attachedAt === null ? ' (not attached yet)' : ''}`;

const feedbackLines = (rows: readonly FeedbackRow[]): readonly CheckLine[] => {
  if (!completeRows(rows)) {
    return [
      fail(
        'feedback rows on your plan trace',
        `feedback rows: ${rows.length}, expected ${SLOTS.length} with distinct slots; run \`pnpm ask\` again and answer all three (step 3)`,
      ),
    ];
  }
  const rowsDetail = rows.map(rowLine).join(' | ');
  return [
    ok('feedback rows on your plan trace', rowsDetail),
    allAttached(rows)
      ? ok('feedback attached to MLflow', `${rows.length} slot_pick assessments`)
      : fail(
          'feedback attached to MLflow',
          `not attached within ${FEEDBACK_WAIT_MS / 1000} s; the backend retries every 5 s, run the check again`,
        ),
  ];
};

/** Tool names in start order from the trace's `tool: '<id>'` spans. */
export const toolOrderFromTrace = (trace: FoundTrace): readonly string[] =>
  [...trace.spans]
    .sort((a, b) => a.startMs - b.startMs)
    .flatMap((span) => {
      const match = TOOL_SPAN.exec(span.name);
      return match ? [match[1] as string] : [];
    });

const toolOrderLine = (trace: FoundTrace | undefined, lastAgent: LastRun): CheckLine => {
  const fromTrace = trace ? toolOrderFromTrace(trace) : [];
  if (fromTrace.length > 0) return ok('tool-call order (trace)', fromTrace.join(' -> '));
  const extras = AgentRunExtras.safeParse(lastAgent);
  const recorded = extras.success ? (extras.data.toolCalls ?? []) : [];
  return ok(
    'tool-call order (last-agent.json)',
    recorded.length > 0 ? recorded.join(' -> ') : 'no tool calls recorded',
  );
};

export const liveChecks03 = async (inputs: LiveInputs03): Promise<readonly CheckLine[]> => {
  const traceId = inputs.lastAgent.traceId;
  const lastRunLine = ok('last agent run', traceId);
  const [rows, { line, trace }] = await Promise.all([
    waitForFeedback(traceId, inputs).catch((error: unknown) => error),
    waitForTrace(traceId, inputs),
  ]);
  if (rows instanceof BackendUnreachableError) {
    return [lastRunLine, blocked('feedback rows on your plan trace', rows.message)];
  }
  if (rows instanceof BackendError) {
    return [lastRunLine, fail('feedback rows on your plan trace', rows.message)];
  }
  if (!Array.isArray(rows)) throw rows;
  return [lastRunLine, ...feedbackLines(rows), line, toolOrderLine(trace, inputs.lastAgent)];
};
