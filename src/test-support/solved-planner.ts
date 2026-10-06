import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { postFeedback } from '../feedback/client.js';
import { createMockTaskModel, type LanguageModelV4 } from '../mastra/model.js';
import { getTimetable } from '../mastra/tools/get-timetable.js';
import { searchArchive } from '../mastra/tools/search-archive.js';
import { FeedbackInput } from '../schemas/feedback.js';

/**
 * Test fixture: the reference planner the harness tests (check:03's own
 * tests, the `pnpm ask` tests) run against, so those suites stay green on
 * every branch whatever state the exercise files are in. The exercise
 * itself is judged by `pnpm check:03` on the real files.
 */
export const solvedSubmitFeedback = createTool({
  id: 'submitFeedback',
  description:
    "Records the user's verdict on one afternoon slot of the plan: thumb up or down and the user's own reason. Call it once per slot the user judged.",
  inputSchema: FeedbackInput,
  outputSchema: z.object({ ok: z.boolean(), id: z.string().optional() }),
  execute: async (input) => postFeedback(input),
});

export const SOLVED_PLANNER_INSTRUCTIONS = `You plan the Frontmania 2026 afternoon (slots 14:15, 15:30, 16:30) for one attendee. Call getTimetable first and recommend only ids it returned. Plan all three slots in one answer and respect the user's constraints. Use searchArchive for one related recording per slot. When the user gives verdicts, call submitFeedback once per slot with their reason.`;

export const createSolvedPlanner = (model: LanguageModelV4 = createMockTaskModel()) =>
  new Agent({
    id: 'planner-agent',
    name: 'planner',
    instructions: SOLVED_PLANNER_INSTRUCTIONS,
    model,
    tools: { getTimetable, searchArchive, submitFeedback: solvedSubmitFeedback },
  });

/** The start-branch planner: placeholder instructions, no tools. */
export const createStartPlanner = (model: LanguageModelV4 = createMockTaskModel()) =>
  new Agent({
    id: 'planner-agent',
    name: 'planner',
    instructions: 'Plan the afternoon.',
    model,
    tools: {},
  });
