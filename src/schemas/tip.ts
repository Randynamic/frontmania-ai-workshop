import { z } from 'zod';
import { Slot, TalkId } from './talk.js';

export const MAX_WHY_LENGTH = 280;

/** One earlier-edition talk worth watching before a slot, found by searchArchive. */
export const Tip = z.object({
  slot: Slot,
  archiveTalkId: TalkId,
  why: z.string().min(1).max(MAX_WHY_LENGTH),
});
export type Tip = z.infer<typeof Tip>;
