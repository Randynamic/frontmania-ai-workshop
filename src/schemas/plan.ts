import { z } from 'zod';
import { Profile } from './profile.js';
import { SlotRanking } from './slot-ranking.js';
import { Slot, SLOTS, Talk } from './talk.js';
import { Tip } from './tip.js';

/** What the plan workflow starts with: the exercise-1 profile, nothing else. */
export const PlanInput = z.object({ profile: Profile });
export type PlanInput = z.infer<typeof PlanInput>;

/** One fan-out item: the profile plus one slot and its talks (expandSlots -> rankSlot). */
export const SlotInput = z.object({
  profile: Profile,
  slot: Slot,
  talks: z.array(Talk).min(1),
});
export type SlotInput = z.infer<typeof SlotInput>;

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
