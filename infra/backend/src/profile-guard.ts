import { z } from 'zod';

/**
 * The backend stores a profile only when it has exactly the shape of the
 * participant-side Profile (src/schemas/profile.ts, written in exercise 1):
 * five known fields plus the optional confidence stretch, `strict`, with
 * every string bounded. A verbose role or an extra key could otherwise carry
 * CV sentences into the store, the ranker prompts and the GEPA dataset.
 * src/schemas/profile.test.ts (from 01-done on) asserts that both schemas
 * produce the same JSON Schema, so they cannot drift apart.
 *
 * The identity-key check stays as a second, readable rejection: it names the
 * offending key ("profile carries identity fields: email").
 */
export const IDENTITY_KEYS = [
  'name',
  'fullname',
  'firstname',
  'lastname',
  'email',
  'phone',
  'employer',
  'company',
  'address',
  'linkedin',
] as const;

export const SENIORITY_LEVELS = ['junior', 'medior', 'senior', 'lead'] as const;
export const MAX_ROLE_LENGTH = 80;
export const MAX_ITEM_LENGTH = 60;
export const MAX_STACK = 10;
export const MAX_INTERESTS = 8;
export const MAX_AVOID = 5;

const Item = z.string().min(1).max(MAX_ITEM_LENGTH);
const Confidence = z.number().min(0).max(1);

export const StoredProfile = z
  .object({
    role: z.string().min(1).max(MAX_ROLE_LENGTH),
    seniority: z.enum(SENIORITY_LEVELS),
    stack: z.array(Item).max(MAX_STACK),
    interests: z.array(Item).max(MAX_INTERESTS),
    avoid: z.array(Item).max(MAX_AVOID),
    confidence: z
      .object({
        role: Confidence,
        seniority: Confidence,
        stack: Confidence,
        interests: Confidence,
        avoid: Confidence,
      })
      .partial()
      .optional(),
  })
  .strict();
export type StoredProfile = z.infer<typeof StoredProfile>;

const normalise = (key: string): string => key.toLowerCase().replace(/[^a-z]/g, '');

export const identityKeysIn = (value: unknown): readonly string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).filter((key) =>
    (IDENTITY_KEYS as readonly string[]).includes(normalise(key)),
  );
};

export const ProfileEnvelope = z.object({ profile: z.record(z.string(), z.unknown()) });

export const rejectionFor = (profile: unknown): string | undefined => {
  const found = identityKeysIn(profile);
  return found.length > 0 ? `profile carries identity fields: ${found.join(', ')}` : undefined;
};
