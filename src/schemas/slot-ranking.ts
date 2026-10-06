import { z } from 'zod';
import { Slot, TalkId } from './talk.js';

export const MAX_REASON_LENGTH = 280;

/** What rankSlot returns per afternoon slot: best talk first, one reason, a confidence. */
export const SlotRanking = z.object({
  slot: Slot,
  ranking: z.array(TalkId).min(1),
  reason: z.string().min(1).max(MAX_REASON_LENGTH),
  confidence: z.number().min(0).max(1),
});
export type SlotRanking = z.infer<typeof SlotRanking>;
