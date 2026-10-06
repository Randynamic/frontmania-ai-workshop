import type { Mastra } from '@mastra/core';
import { PLAN_WORKFLOW_ID, RANK_CONCURRENCY } from '../../../src/mastra/workflows/plan.js';
import { Plan, type PlanInput } from '../../../src/schemas/plan.js';
import { SLOTS } from '../../../src/schemas/talk.js';
import { assertion, fail, ok, type CheckLine } from '../lib.js';
import { rankingChecks, tipsCheck } from './plan-shape.js';

/**
 * Static layer of pnpm check:02: offline, mock model and seed prompts. It
 * reads the three exercise files for leftover markers, the workflow graph
 * for the fan-out, and runs the workflow once on a persona profile.
 */
export const EXERCISE_MARKER = 'TODO(exercise 02';
export const NOT_IMPLEMENTED_HINT = 'exercise 02, step 1';

export interface StaticInputs02 {
  readonly mastra: Mastra;
  /** Source text of the three files the participant edits, keyed by step. */
  readonly sources: { readonly rankSlot: string; readonly plan: string; readonly tip: string };
  readonly profile: PlanInput['profile'];
}

const markerChecks = (sources: StaticInputs02['sources']): readonly CheckLine[] => [
  assertion(
    'no exercise marker in src/mastra/workflows/steps/rank-slot.ts',
    !sources.rankSlot.includes(EXERCISE_MARKER),
    `a ${EXERCISE_MARKER}, step 1) marker remains (step 1)`,
  ),
  assertion(
    'no exercise marker in src/mastra/workflows/plan.ts',
    !sources.plan.includes(EXERCISE_MARKER),
    `a ${EXERCISE_MARKER}, step 2) marker remains (step 2)`,
  ),
  assertion(
    'no exercise marker in src/mastra/workflows/steps/tip.ts',
    !sources.tip.includes(EXERCISE_MARKER),
    `a ${EXERCISE_MARKER}, step 3) marker remains (step 3)`,
  ),
];

/** The id of the step a foreach entry iterates (the entry's `step` is itself a step entry). */
const iteratedStepId = (entry: { readonly step?: unknown }): string | undefined => {
  const inner = entry.step;
  if (!inner || typeof inner !== 'object' || !('step' in inner)) return undefined;
  const step = (inner as { step?: { id?: unknown } }).step;
  return typeof step?.id === 'string' ? step.id : undefined;
};

/** The foreach entry's static concurrency; absent `opts` means 1 (types.d.ts, SerializedStepFlowEntry). */
export const foreachConcurrency = (mastra: Mastra): number | undefined => {
  const graph = mastra.getWorkflow(PLAN_WORKFLOW_ID).serializedStepGraph;
  const entry = graph.find((e) => e.type === 'foreach' && iteratedStepId(e) === 'rankSlot');
  if (!entry) return undefined;
  const opts = 'opts' in entry ? entry.opts : undefined;
  return opts?.concurrency ?? 1;
};

const concurrencyCheck = (mastra: Mastra): CheckLine => {
  const concurrency = foreachConcurrency(mastra);
  if (concurrency === undefined) {
    return fail('rankSlot fans out', 'planWorkflow has no foreach over rankSlot (step 2)');
  }
  return assertion(
    'rankSlot fans out',
    concurrency === RANK_CONCURRENCY,
    `rankSlot runs with concurrency ${concurrency}, expected ${RANK_CONCURRENCY} (step 2)`,
    `concurrency ${concurrency}`,
  );
};

const runChecks = async (inputs: StaticInputs02): Promise<readonly CheckLine[]> => {
  const run = await inputs.mastra.getWorkflow(PLAN_WORKFLOW_ID).createRun();
  const result = await run
    .start({ inputData: { profile: inputs.profile } })
    .catch((error: unknown) => ({
      status: 'failed' as const,
      error: error instanceof Error ? error : new Error(String(error)),
    }));
  if (result.status !== 'success') {
    const message = result.status === 'failed' ? result.error.message : `status ${result.status}`;
    return [
      fail(
        'mock run of the plan workflow',
        message.includes(NOT_IMPLEMENTED_HINT)
          ? 'rankSlot not implemented (step 1)'
          : `${message} (step 1, 2 or 3; read the message)`,
      ),
    ];
  }
  const parsed = Plan.safeParse(result.result);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return [
      ok('mock run of the plan workflow', 'status success'),
      fail(
        'plan validates',
        `Plan rejected at ${first?.path.join('.') || '<root>'}: ${first?.message} (step 1 or 3)`,
      ),
    ];
  }
  const plan = parsed.data;
  return [
    ok('mock run of the plan workflow', 'status success'),
    ok('plan validates'),
    ...rankingChecks(plan),
    tipsCheck(plan, (count) =>
      count === 0
        ? `tips: expected ${SLOTS.length}, got 0; hits is still empty, fill it from searchArchive (step 3)`
        : `tips: expected ${SLOTS.length}, got ${count} (step 3)`,
    ),
  ];
};

export const staticChecks02 = async (inputs: StaticInputs02): Promise<readonly CheckLine[]> => [
  ...markerChecks(inputs.sources),
  concurrencyCheck(inputs.mastra),
  ...(await runChecks(inputs)),
  ok('static layer', 'offline, mock model, seed prompts'),
];
