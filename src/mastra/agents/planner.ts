/* eslint-disable @typescript-eslint/no-unused-vars -- TODO(exercise 03, step 2): delete this line when the planner has its three tools */
import { Agent } from '@mastra/core/agent';
import { taskModel } from '../model.js';
import { getTimetable } from '../tools/get-timetable.js';
import { searchArchive } from '../tools/search-archive.js';
import { submitFeedback } from '../tools/submit-feedback.js';

/**
 * The planner agent (exercise 3): answers an open question about the
 * afternoon with three tools and records the user's verdicts on the plan.
 * Unlike the plan workflow (exercise 2), the agent decides at run time
 * which tool to call and when; `pnpm ask` caps it at MAX_AGENT_STEPS.
 *
 * Verified 26 Sep 2026 against @mastra/core 1.71.0: `new Agent({ id, name,
 * instructions, model, tools })` (agent/types.d.ts), `agent.listTools()`
 * (agent/agent.d.ts line 764) resolves to the tools record keyed as given.
 */
export const PLANNER_AGENT_ID = 'planner-agent';

// TODO(exercise 03, step 2): write the instructions the planner follows (at least 200 characters):
//   - plan all three slots (14:15, 15:30, 16:30) in one answer
//   - call getTimetable first and recommend only ids it returned
//   - use searchArchive for one related recording per slot
//   - respect the user's constraints ("no Angular", "something on accessibility")
//   - when the user gives verdicts, call submitFeedback once per slot with their reason
export const PLANNER_INSTRUCTIONS = 'Plan the afternoon.';

type PlannerAgentModel = ConstructorParameters<typeof Agent>[0]['model'];

export const createPlannerAgent = (model: PlannerAgentModel) =>
  new Agent({
    id: PLANNER_AGENT_ID,
    name: 'planner',
    instructions: PLANNER_INSTRUCTIONS,
    model,
    // TODO(exercise 03, step 2): give the planner its three tools, then delete the
    // eslint-disable line at the top of this file (it carries this marker too):
    //   tools: { getTimetable, searchArchive, submitFeedback },
    tools: {},
  });

export const plannerAgent = createPlannerAgent(() => taskModel());
