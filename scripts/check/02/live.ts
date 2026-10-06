import { z } from 'zod';
import type { LastRun } from '../../../src/run/record.js';
import { Plan } from '../../../src/schemas/plan.js';
import { SLOTS } from '../../../src/schemas/talk.js';
import { assertion, fail, ok, warn, type CheckLine } from '../lib.js';
import { rankingChecks, tipsCheck } from './plan-shape.js';
import { waitForTrace, type FoundTrace, type TraceWaitDeps } from '../trace.js';

/**
 * Live layer of pnpm check:02: the last `pnpm plan` run (validated like the
 * static layer, three tips included, so a stale run from before step 3
 * fails), its trace at the backend (three rankSlot spans that overlap in
 * time: the parallel proof), the numbers for the workbook, and the last
 * `pnpm compare` if any.
 */
const RANK_STEP_SPAN = 'rankSlot';

const PlanRunExtras = z.object({ plan: z.unknown() });

export interface LiveInputs02 extends TraceWaitDeps {
  readonly lastPlan: LastRun;
  readonly lastCompare: LastRun | undefined;
}

/** Step spans of rankSlot and whether their time windows overlap (concurrency > 1). */
export const rankSpanOverlap = (
  trace: FoundTrace,
): { readonly count: number; readonly overlap: boolean } => {
  const spans = trace.spans.filter((s) => s.name.includes(RANK_STEP_SPAN));
  const latestStart = Math.max(...spans.map((s) => s.startMs));
  const earliestEnd = Math.min(...spans.map((s) => s.endMs));
  return { count: spans.length, overlap: spans.length > 1 && latestStart < earliestEnd };
};

const topPicksLine = (plan: Plan): string =>
  `top picks: ${SLOTS.map((slot) => `${slot} ${plan.rankings.find((r) => r.slot === slot)?.ranking[0] ?? '-'}`).join(' | ')}`;

export const liveChecks02 = async (inputs: LiveInputs02): Promise<readonly CheckLine[]> => {
  const extras = PlanRunExtras.safeParse(inputs.lastPlan);
  const plan = extras.success ? Plan.safeParse(extras.data.plan) : undefined;
  if (!plan?.success) {
    return [
      fail('last plan validates', 'last-plan.json holds no valid plan; run `pnpm plan` again'),
    ];
  }
  const planLines = [
    ok('last plan validates', topPicksLine(plan.data)),
    ...rankingChecks(plan.data),
    tipsCheck(
      plan.data,
      (count) =>
        `last pnpm plan has ${count} tips, expected ${SLOTS.length}; run \`pnpm plan\` again (step 3)`,
    ),
  ];
  const { line, trace } = await waitForTrace(inputs.lastPlan.traceId, inputs);
  if (!trace) return [...planLines, line];
  const { count, overlap } = rankSpanOverlap(trace);
  const tokens = trace.tokens ?? inputs.lastPlan.tokens;
  const latency = trace.latencyMs ?? inputs.lastPlan.latencyMs;
  const compareLine = inputs.lastCompare
    ? ok(
        'last compare run',
        `tokens: ${inputs.lastCompare.tokens ?? 'n/a'}  latency: ${inputs.lastCompare.latencyMs ?? 'n/a'} ms (both variants)`,
      )
    : warn(
        'last compare run',
        'not found; run `pnpm compare` when there is time, or read the numbers from the trainer screen',
      );
  return [
    ...planLines,
    line,
    assertion(
      'rankSlot spans in the trace',
      count === SLOTS.length,
      `${count} rankSlot span(s), expected ${SLOTS.length} (step 1)`,
      `${count}`,
    ),
    assertion(
      'rankSlot spans overlap in time',
      overlap,
      'the three slots ran one after another; set concurrency to 3 (step 2)',
      'parallel',
    ),
    ok('numbers for the workbook', `tokens: ${tokens ?? 'n/a'}  latency: ${latency ?? 'n/a'} ms`),
    compareLine,
  ];
};
