import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { talksForSlot } from '../../data/program.js';
import { SLOTS, Slot, Talk } from '../../schemas/talk.js';
import { programOnce } from '../workflows/steps/expand-slots.js';

/**
 * getTimetable (given in exercise 3): the talks of one afternoon slot, or of
 * all three when no slot is named, from data/program-2026.json (or its
 * fixture). The planner agent calls it first, so every talk id it mentions
 * comes from the programme and not from the model's memory.
 *
 * Verified 26 Sep 2026 against @mastra/core 1.71.0 tools/tool.d.ts:
 * `createTool({ id, description, inputSchema, outputSchema, execute })`;
 * `execute(input, context)` receives the validated input first.
 */
export const GET_TIMETABLE_ID = 'getTimetable';

export const GetTimetableInput = z.object({
  slot: Slot.optional().describe('One of 14:15, 15:30, 16:30; leave out for all three slots'),
});
export type GetTimetableInput = z.infer<typeof GetTimetableInput>;

export const GetTimetableOutput = z.object({ talks: z.array(Talk) });
export type GetTimetableOutput = z.infer<typeof GetTimetableOutput>;

/** Talks for one slot, or for every slot in SLOTS order. */
export const timetable = (slot: Slot | undefined): GetTimetableOutput => {
  const { program } = programOnce();
  const slots = slot ? [slot] : SLOTS;
  return { talks: slots.flatMap((s) => [...talksForSlot(program, s)]) };
};

export const getTimetable = createTool({
  id: GET_TIMETABLE_ID,
  description:
    'Lists the Frontmania 2026 talks of one afternoon slot (14:15, 15:30 or 16:30), or of all three when no slot is given: id, title, speakers, room, start time, duration and abstract. Call it before recommending any talk; only recommend ids it returned.',
  inputSchema: GetTimetableInput,
  outputSchema: GetTimetableOutput,
  execute: async (input) => timetable(input.slot),
});
