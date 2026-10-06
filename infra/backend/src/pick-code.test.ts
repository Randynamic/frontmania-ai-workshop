import { describe, expect, test } from 'vitest';
import { isValidPickCode, PICK_CODE_LENGTH, pickCodeFor } from './pick-code.js';

const SECRET = 'admin-token-for-tests-0123456789';

describe('pick code', () => {
  test('is a stable 8-character hex code per id and secret', () => {
    const code = pickCodeFor(SECRET, 'otter-42');
    expect(code).toMatch(new RegExp(`^[0-9a-f]{${PICK_CODE_LENGTH}}$`));
    expect(pickCodeFor(SECRET, 'otter-42')).toBe(code);
    expect(pickCodeFor(SECRET, 'otter-43')).not.toBe(code);
    expect(pickCodeFor('another-secret-0123456789', 'otter-42')).not.toBe(code);
  });

  test("accepts the id's own code in any case and rejects another id's code", () => {
    const code = pickCodeFor(SECRET, 'otter-42');
    expect(isValidPickCode(SECRET, 'otter-42', code.toUpperCase())).toBe(true);
    expect(isValidPickCode(SECRET, 'otter-42', ` ${code} `)).toBe(true);
    expect(isValidPickCode(SECRET, 'otter-43', code)).toBe(false);
    expect(isValidPickCode(SECRET, 'otter-42', '')).toBe(false);
    expect(isValidPickCode(SECRET, 'otter-42', `${code}0`)).toBe(false);
  });
});
