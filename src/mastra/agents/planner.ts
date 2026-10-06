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

// Exercise 3, step 2: the instructions the planner follows.
export const PLANNER_INSTRUCTIONS = `You plan the Frontmania 2026 afternoon for one attendee. The afternoon has three slots: 14:15, 15:30 and 16:30.

When asked for a plan:
- Call getTimetable first. Recommend only talks and ids it returned; never invent a talk.
- Plan all three slots in one answer: for each slot one talk with its id, title and one sentence on why it fits.
- Respect every constraint the user states (a technology to avoid, a topic they want). If no talk in a slot fits, say so and name the least bad option.
- For each slot call searchArchive once with the chosen talk's topic and add one related recording from an earlier edition (id and title) as preparation.
- End by asking for a thumb up or down per slot with a short reason.

When the user gives verdicts on the plan:
- Call submitFeedback once per slot they judged, with that slot, their thumb (up or down) and their reason in their own words, shortened to 280 characters if needed.
- Do not call submitFeedback for a slot they did not judge, and never make up a verdict.
- Confirm in one line per slot what you recorded.

Be brief and concrete. No marketing language.`;

type PlannerAgentModel = ConstructorParameters<typeof Agent>[0]['model'];

export const createPlannerAgent = (model: PlannerAgentModel) =>
  new Agent({
    id: PLANNER_AGENT_ID,
    name: 'planner',
    instructions: PLANNER_INSTRUCTIONS,
    model,
    // Exercise 3, step 2: the three tools the planner may call.
    tools: { getTimetable, searchArchive, submitFeedback },
  });

export const plannerAgent = createPlannerAgent(() => taskModel());
