import { hashKey } from '../../backend/src/auth.js';
import type { IdVariant } from '../../backend/src/env.js';

/**
 * The body keys-create.ts posts to POST /api/admin/keys, shared with the
 * backend tests so the real request shape is exercised in both id variants.
 *
 * slip: the pseudonym is printed on the card, so the key is linked at once.
 * page: the blind-pick page issues the id later; the key starts unlinked and
 * /api/whoami answers 409 until pnpm run doctor calls /api/register.
 */
export interface KeyRegistrationBody {
  readonly pseudonym: string;
  readonly keyHash: string;
  readonly linked: boolean;
}

export const keyRegistrationBody = (
  pseudonym: string,
  key: string,
  variant: IdVariant,
): KeyRegistrationBody => ({ pseudonym, keyHash: hashKey(key), linked: variant === 'slip' });
