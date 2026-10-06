import type { SlotInput } from '../../../schemas/plan.js';
import type { SlotRanking } from '../../../schemas/slot-ranking.js';

/**
 * Given: what rankSlot does with the ranker's answer before it leaves the
 * step. Structured output validates the shape, not the content, so a live
 * model can still name the wrong slot or a talk from another slot. The step
 * knows its slot, so the answer's `slot` is set from the input; an id that is
 * not one of the slot's talks fails the step with a message that names it.
 */
export class ForeignTalkError extends Error {
  constructor(slot: string, ids: readonly string[]) {
    super(
      `the ranker named talk id(s) outside slot ${slot}: ${ids.join(', ')}; run again (step 1)`,
    );
    this.name = 'ForeignTalkError';
  }
}

export const keepToSlot = (
  answer: SlotRanking,
  input: Pick<SlotInput, 'slot' | 'talks'>,
): SlotRanking => {
  const slotIds = new Set(input.talks.map((talk) => talk.id));
  const foreign = answer.ranking.filter((id) => !slotIds.has(id));
  if (foreign.length > 0) throw new ForeignTalkError(input.slot, foreign);
  return { ...answer, slot: input.slot };
};
