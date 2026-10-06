import { describe, expect, test } from 'vitest';
import { bearerFrom, hashKey } from './auth.js';
import { identityKeysIn, rejectionFor } from './profile-guard.js';
import { readBackendEnv } from './env.js';
import { generatePseudonyms, MAX_PSEUDONYMS } from '../../scripts/lib/pseudonym.js';
import { flagNumber, parseArgs } from '../../scripts/lib/args.js';

describe('auth helpers', () => {
  test('hashKey is sha256 hex and bearerFrom parses the header', () => {
    expect(hashKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(bearerFrom('Bearer sk-1')).toBe('sk-1');
    expect(bearerFrom('bearer sk-2')).toBe('sk-2');
    expect(bearerFrom('Basic x')).toBeUndefined();
    expect(bearerFrom(undefined)).toBeUndefined();
  });
});

describe('profile guard', () => {
  test('finds identity keys regardless of casing and separators', () => {
    expect(identityKeysIn({ role: 'x', 'Full Name': 'y', e_mail: 'z' })).toEqual([
      'Full Name',
      'e_mail',
    ]);
    expect(identityKeysIn(['name'])).toEqual([]);
    expect(rejectionFor({ role: 'x' })).toBeUndefined();
    expect(rejectionFor({ phone: '1' })).toContain('phone');
  });
});

describe('backend env', () => {
  test('applies defaults and fails fast on a short admin token', () => {
    const env = readBackendEnv({ WORKSHOP_ADMIN_TOKEN: 'long-enough-admin-token' });
    expect(env.PORT).toBe(3000);
    expect(env.MLFLOW_URL).toBe('http://localhost:5000');
    expect(() => readBackendEnv({ WORKSHOP_ADMIN_TOKEN: 'short' })).toThrow(/WORKSHOP_ADMIN_TOKEN/);
  });
});

describe('script helpers', () => {
  test('pseudonyms are distinct and shaped animal-number, up to every combination', () => {
    const ids = generatePseudonyms(45, 3);
    expect(new Set(ids).size).toBe(45);
    for (const id of ids) expect(id).toMatch(/^[a-z]+-\d{2}$/);
    expect(new Set(generatePseudonyms(MAX_PSEUDONYMS, 7)).size).toBe(MAX_PSEUDONYMS);
    expect(new Set(generatePseudonyms(200, 0)).size).toBe(200);
    expect(() => generatePseudonyms(MAX_PSEUDONYMS + 1)).toThrow(/between 0 and/);
  });

  test('parseArgs handles flags with values, bare flags and positionals', () => {
    const args = parseArgs(['--count', '10', '--dry-run', 'extra', '--budget', '2.5']);
    expect(args.flags).toEqual({ count: '10', 'dry-run': true, budget: '2.5' });
    expect(args.positional).toEqual(['extra']);
    expect(flagNumber(args, 'count', 1)).toBe(10);
    expect(flagNumber(args, 'missing', 7)).toBe(7);
    expect(() => flagNumber(parseArgs(['--count', 'x']), 'count', 1)).toThrow(/number/);
  });
});
