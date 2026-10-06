import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { loadProgram, talksForSlot, type LoadedProgram } from '../../../data/program.js';
import { PlanInput, SlotInput } from '../../../schemas/plan.js';
import { SLOTS } from '../../../schemas/talk.js';

/**
 * Step 1 of the plan workflow (given): one SlotInput per afternoon slot, in
 * SLOTS order, with the slot's talks from data/program-2026.json. Returning
 * an array is what lets the workflow `.foreach(rankSlot, ...)` over it.
 *
 * Verified 26 Sep 2026 against @mastra/core 1.71.0 workflows/workflow.d.ts:
 * `createStep({ id, inputSchema, outputSchema, execute })`, and `execute`
 * receives `{ inputData, mastra, tracingContext, getInitData, ... }`
 * (workflows/step.d.ts, ExecuteFunctionParams).
 */
let cachedProgram: LoadedProgram | undefined;

/** The programme, loaded once per process (the loader logs when it falls back to the fixture). */
export const programOnce = (): LoadedProgram => {
  cachedProgram ??= loadProgram();
  return cachedProgram;
};

export const expandSlots = createStep({
  id: 'expandSlots',
  inputSchema: PlanInput,
  outputSchema: z.array(SlotInput),
  execute: async ({ inputData }) => {
    const { program } = programOnce();
    return SLOTS.map((slot) => ({
      profile: inputData.profile,
      slot,
      talks: [...talksForSlot(program, slot)],
    }));
  },
});
