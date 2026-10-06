import { createWorkflow } from '@mastra/core/workflows';
import { Plan, PlanInput } from '../../schemas/plan.js';
import { expandSlots } from './steps/expand-slots.js';
import { rankSlot } from './steps/rank-slot.js';
import { tipStep } from './steps/tip.js';

/**
 * The plan workflow: profile in, afternoon plan out.
 *
 *   expandSlots  ->  rankSlot x 3 (foreach, in parallel)  ->  tip
 *
 * Exercise 2, step 2 is the `concurrency` on the foreach line: 1 runs the
 * three slots one after another, 3 runs them at the same time. Verified 26
 * Sep 2026 against @mastra/core 1.71.0: `.foreach(step, { concurrency })`
 * (workflows/workflow.d.ts line 383, ForeachOptions in types.d.ts), the
 * previous step must return an array, `.commit()` closes the graph and
 * `serializedStepGraph` shows the foreach entry with its `opts`.
 */
export const PLAN_WORKFLOW_ID = 'plan';
/** What the done state runs with; the check compares the graph against it. */
export const RANK_CONCURRENCY = 3;

export const planWorkflow = createWorkflow({
  id: PLAN_WORKFLOW_ID,
  inputSchema: PlanInput,
  outputSchema: Plan,
})
  .then(expandSlots)
  // TODO(exercise 02, step 2): rank the three slots in parallel: concurrency 3, not 1.
  .foreach(rankSlot, { concurrency: 1 })
  .then(tipStep)
  .commit();
