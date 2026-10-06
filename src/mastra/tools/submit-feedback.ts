import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { postFeedback } from '../../feedback/client.js';
import { FeedbackInput } from '../../schemas/feedback.js';

/**
 * submitFeedback (exercise 3, step 1): the tool the planner agent calls once
 * per slot when the user gives a verdict on the plan. The description is a
 * prompt: it is what the model reads to decide when and how to call it.
 * `postFeedback` attaches the verdict to the trace of the current run (the
 * plan the user is judging); the backend stores it and attaches it to
 * MLflow as a `slot_pick` feedback assessment.
 *
 * Verified 26 Sep 2026 against @mastra/core 1.71.0 tools/tool.d.ts:
 * `createTool({ id, description, inputSchema, outputSchema, execute })`.
 */
export const SUBMIT_FEEDBACK_ID = 'submitFeedback';

export const submitFeedback = createTool({
  id: SUBMIT_FEEDBACK_ID,
  description:
    "Records the user's verdict on one afternoon slot of the plan: thumb up or down and the user's own reason. Call it once per slot the user judged, only after the user gave a verdict, never on your own judgement.",
  inputSchema: FeedbackInput,
  outputSchema: z.object({ ok: z.boolean(), id: z.string().optional() }),
  execute: async (input) => postFeedback(input),
});
