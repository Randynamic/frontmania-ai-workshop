import { z } from 'zod';
import { SlotRanking } from './slot-ranking.js';
import { SLOTS } from './talk.js';
import { Tip } from './tip.js';

/**
 * The plan workflow's output: one ranking per slot and up to one tip per
 * slot. Tips are bounded by `max`, not `length`, so the exercise 2 start
 * branch (tipStep returns no tips yet) still produces a valid Plan.
 */
export const Plan = z.object({
  rankings: z.array(SlotRanking).length(SLOTS.length),
  tips: z.array(Tip).max(SLOTS.length),
});
export type Plan = z.infer<typeof Plan>;
