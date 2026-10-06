import { z } from 'zod';
import { Slot } from './talk.js';

export const MAX_REASON_LENGTH = 280;

/** One verdict on one slot. Shared by the submitFeedback tool and the workshop backend. */
export const FeedbackInput = z.object({
  slot: Slot,
  thumb: z.enum(['up', 'down']),
  reason: z.string().min(1).max(MAX_REASON_LENGTH),
});
export type FeedbackInput = z.infer<typeof FeedbackInput>;
