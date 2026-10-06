import { z } from 'zod';

/**
 * The profile the exercise-1 agent extracts from a CV or a typed skills list.
 *
 * Deliberately no name, email, phone, employer or company field: the model
 * cannot output what the schema has no room for, the backend rejects any
 * such key (infra/backend/src/profile-guard.ts), and the trace masker
 * (src/observability/mask.ts) covers the input side. `strict` closes the
 * door on extra keys the model might add on its own.
 *
 * Bounds keep the ranking prompt small and predictable: a profile is a
 * handful of facts, not the CV in another shape. Exercise 1, step 1 adds
 * them: stack max 10, interests max 8, avoid max 5.
 */
export const SENIORITY_LEVELS = ['junior', 'medior', 'senior', 'lead'] as const;
export const Seniority = z.enum(SENIORITY_LEVELS);
export type Seniority = z.infer<typeof Seniority>;

/** A role is one short phrase and a list item a few words: no room for CV sentences. */
export const MAX_ROLE_LENGTH = 80;
export const MAX_ITEM_LENGTH = 60;
export const MAX_STACK = 10;
export const MAX_INTERESTS = 8;
export const MAX_AVOID = 5;

const Item = z.string().min(1).max(MAX_ITEM_LENGTH);

export const Profile = z
  .object({
    /** What the person does, one short phrase, no employer name ("front-end architect at a logistics scale-up"). */
    role: z.string().min(1).max(MAX_ROLE_LENGTH),
    seniority: Seniority,
    /** Technologies actually used, most recent first. */
    // TODO(exercise 01, step 1): bound to MAX_STACK items with .max(...)
    stack: z.array(Item),
    /** Topics the person wants to see talks about. */
    // TODO(exercise 01, step 1): bound to MAX_INTERESTS items
    interests: z.array(Item),
    /** Topics the person does not want; the ranker treats these as hard filters. */
    // TODO(exercise 01, step 1): bound to MAX_AVOID items
    avoid: z.array(Item),
  })
  .strict();
export type Profile = z.infer<typeof Profile>;
