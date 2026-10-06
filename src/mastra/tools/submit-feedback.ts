/* eslint-disable @typescript-eslint/no-unused-vars -- TODO(exercise 03, step 1): delete this line when submitFeedback is defined */
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

// TODO(exercise 03, step 1): define the tool, then delete the eslint-disable line at the top
// of this file (it carries this marker too):
//   description: a sentence the model reads, e.g. "Record the user's verdict on one afternoon slot; call once per slot"
//   inputSchema: FeedbackInput (src/schemas/feedback.ts), or the same three fields written out:
//     z.object({ slot: Slot, thumb: z.enum(['up', 'down']), reason: z.string().max(280) })
//   outputSchema: z.object({ ok: z.boolean(), id: z.string().optional() })
//   execute: async (input) => postFeedback(input)
export const submitFeedback = createTool({
  id: SUBMIT_FEEDBACK_ID,
  description: '',
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: false }),
});
