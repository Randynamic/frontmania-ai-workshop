import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Possession token for the blind pick. The pseudonym alone is guessable
 * (20 animals x 90 numbers), so POST /api/picks also needs the pick code
 * that only the holder of the id received: printed on the key card (slip
 * variant) or returned once by POST /api/ids (page variant).
 * The code is an HMAC of the id under WORKSHOP_ADMIN_TOKEN, so keys-create.ts
 * and the backend derive the same value without storing it. Rotating the
 * admin token after printing the cards invalidates every printed code.
 */
export const PICK_CODE_LENGTH = 8;
const DOMAIN = 'talk-picker:pick-code:';

export const pickCodeFor = (secret: string, participantId: string): string =>
  createHmac('sha256', secret)
    .update(`${DOMAIN}${participantId}`)
    .digest('hex')
    .slice(0, PICK_CODE_LENGTH);

export const isValidPickCode = (secret: string, participantId: string, code: string): boolean => {
  const expected = Buffer.from(pickCodeFor(secret, participantId));
  const given = Buffer.from(code.trim().toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
};
