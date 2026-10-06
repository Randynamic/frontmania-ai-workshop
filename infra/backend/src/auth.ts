import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { Store } from './store.js';

export type AuthVariables = { participantId: string; keyHash: string };

export const hashKey = (key: string): string =>
  createHash('sha256').update(key, 'utf8').digest('hex');

export const bearerFrom = (header: string | undefined): string | undefined => {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1];
};

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

/** Participant routes: the bearer key must hash to a known, unrevoked key. */
export const participantAuth =
  (store: Store): MiddlewareHandler<{ Variables: AuthVariables }> =>
  async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    const key = bearerFrom(c.req.header('authorization'));
    if (!key) return c.json({ ok: false, error: 'missing bearer key' }, 401);
    const keyHash = hashKey(key);
    const record = await store.findKey(keyHash);
    if (!record) return c.json({ ok: false, error: 'unknown key' }, 401);
    if (record.revokedAt !== null) return c.json({ ok: false, error: 'key revoked' }, 401);
    c.set('participantId', record.pseudonym);
    c.set('keyHash', keyHash);
    await next();
  };

/** Admin routes: constant-time comparison against WORKSHOP_ADMIN_TOKEN. */
export const adminAuth =
  (adminToken: string): MiddlewareHandler =>
  async (c: Context, next: Next) => {
    const token = bearerFrom(c.req.header('authorization'));
    if (!token || !safeEqual(token, adminToken)) {
      return c.json({ ok: false, error: 'admin token required' }, 401);
    }
    await next();
  };
