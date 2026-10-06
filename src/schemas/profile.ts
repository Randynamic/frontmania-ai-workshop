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
 * handful of facts, not the CV in another shape.
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

const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 1;
const Item = z.string().min(1).max(MAX_ITEM_LENGTH);
const Confidence = z.number().min(MIN_CONFIDENCE).max(MAX_CONFIDENCE);

/** Stretch (exercise 1): how sure the agent is per field, 0 to 1. Optional, so the check accepts both. */
export const ProfileConfidence = z
  .object({
    role: Confidence,
    seniority: Confidence,
    stack: Confidence,
    interests: Confidence,
    avoid: Confidence,
  })
  .partial();
export type ProfileConfidence = z.infer<typeof ProfileConfidence>;

export const Profile = z
  .object({
    /** What the person does, one short phrase, no employer name ("front-end architect at a logistics scale-up"). */
    role: z.string().min(1).max(MAX_ROLE_LENGTH),
    seniority: Seniority,
    /** Technologies actually used, most recent first. */
    stack: z.array(Item).max(MAX_STACK),
    /** Topics the person wants to see talks about. */
    interests: z.array(Item).max(MAX_INTERESTS),
    /** Topics the person does not want; the ranker treats these as hard filters. */
    avoid: z.array(Item).max(MAX_AVOID),
    confidence: ProfileConfidence.optional(),
  })
  .strict();
export type Profile = z.infer<typeof Profile>;
