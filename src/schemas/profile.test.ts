import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { StoredProfile } from '../../infra/backend/src/profile-guard.js';
import { IDENTITY_KEYS, loadPersonas } from '../data/personas.js';
import {
  MAX_AVOID,
  MAX_INTERESTS,
  MAX_ITEM_LENGTH,
  MAX_ROLE_LENGTH,
  MAX_STACK,
  Profile,
  SENIORITY_LEVELS,
} from './profile.js';

const valid: Profile = {
  role: 'front-end architect at a logistics scale-up',
  seniority: 'lead',
  stack: ['TypeScript', 'React', 'Next.js'],
  interests: ['tracing for LLM features', 'evaluation'],
  avoid: ['vendor keynotes'],
};

const items = (count: number): string[] => Array.from({ length: count }, (_, i) => `item-${i}`);

describe('Profile schema', () => {
  test('accepts a complete profile and keeps every field', () => {
    const parsed = Profile.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(valid);
  });

  test.each([
    ['stack', MAX_STACK],
    ['interests', MAX_INTERESTS],
    ['avoid', MAX_AVOID],
  ] as const)('%s accepts %i items and rejects one more', (field, max) => {
    expect(Profile.safeParse({ ...valid, [field]: items(max) }).success).toBe(true);
    const tooMany = Profile.safeParse({ ...valid, [field]: items(max + 1) });
    expect(tooMany.success).toBe(false);
    expect(!tooMany.success && tooMany.error.issues[0]?.path).toEqual([field]);
  });

  test('seniority is the four-level scale only', () => {
    for (const level of SENIORITY_LEVELS) {
      expect(Profile.safeParse({ ...valid, seniority: level }).success).toBe(true);
    }
    expect(Profile.safeParse({ ...valid, seniority: 'principal' }).success).toBe(false);
  });

  test('has no identity field and rejects one when the model adds it', () => {
    const keys = Object.keys(Profile.shape);
    for (const identityKey of IDENTITY_KEYS) expect(keys).not.toContain(identityKey);
    expect(Profile.safeParse({ ...valid, name: 'Lotte' }).success).toBe(false);
    expect(Profile.safeParse({ ...valid, employer: 'Hexaloop' }).success).toBe(false);
  });

  test('confidence is optional, partial and bounded to 0..1', () => {
    expect(Profile.safeParse({ ...valid, confidence: { role: 0.9 } }).success).toBe(true);
    expect(Profile.safeParse({ ...valid, confidence: {} }).success).toBe(true);
    expect(Profile.safeParse({ ...valid, confidence: { stack: 1.2 } }).success).toBe(false);
  });

  test('empty strings inside the arrays are rejected', () => {
    expect(Profile.safeParse({ ...valid, stack: [''] }).success).toBe(false);
    expect(Profile.safeParse({ ...valid, role: '' }).success).toBe(false);
  });

  test('every committed persona profile validates', () => {
    const personas = loadPersonas();
    expect(personas).toHaveLength(5);
    for (const persona of personas) {
      expect(Profile.safeParse(persona.profile).success, persona.name).toBe(true);
    }
  });

  test('role and list items are bounded, so a CV sentence does not fit', () => {
    const sentence =
      'Senior Frontend Engineer who rebuilt the checkout of a large Dutch web shop in Next.js';
    expect(Profile.safeParse({ ...valid, role: 'r'.repeat(MAX_ROLE_LENGTH) }).success).toBe(true);
    expect(Profile.safeParse({ ...valid, role: 'r'.repeat(MAX_ROLE_LENGTH + 1) }).success).toBe(
      false,
    );
    expect(Profile.safeParse({ ...valid, stack: ['s'.repeat(MAX_ITEM_LENGTH)] }).success).toBe(
      true,
    );
    for (const field of ['stack', 'interests', 'avoid'] as const) {
      expect(Profile.safeParse({ ...valid, [field]: [sentence] }).success, field).toBe(false);
    }
  });

  test('the backend stores exactly this shape: same JSON Schema as StoredProfile', () => {
    expect(z.toJSONSchema(StoredProfile)).toEqual(z.toJSONSchema(Profile));
  });
});
