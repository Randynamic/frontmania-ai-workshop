import type { Hono } from 'hono';
import { z } from 'zod';
import { Slot } from '../../../src/schemas/talk.js';
import { PARTICIPANT_ID_PATTERN, type AppDeps } from './deps.js';
import { isValidPickCode, pickCodeFor } from './pick-code.js';
import { renderPickPage } from './pick-page.js';
import { talkIdsBySlot } from './program.js';
import { createRateLimiter } from './rate-limit.js';

/**
 * Conference wifi puts the whole room behind one or a few NAT addresses and
 * the run sheet has everyone submitting the blind pick in minute 1, so the
 * pick limit is keyed by participant id, not by address. The per-address cap
 * only stops a flood: 40 phones x 15 submits is still under it.
 */
const PICKS_PER_ID_PER_MINUTE = 20;
const PUBLIC_POSTS_PER_IP_PER_MINUTE = 600;
const ONE_MINUTE_MS = 60_000;
/** Page variant: about 3x a full room of 50, out of the 1800-id animal-number space. */
export const MAX_ISSUED_IDS = 150;
/**
 * Page variant: ids one address may take per session. A full room (50) behind
 * one conference NAT still fits; one client alone takes at most 60 of the 150,
 * so draining the pool needs three or more addresses. Caddy overwrites
 * X-Forwarded-For (no trusted_proxies), so the first entry is the real address.
 */
export const MAX_IDS_PER_ADDRESS = 60;
const ID_WINDOW_MS = 2 * 60 * ONE_MINUTE_MS;

const PicksBody = z.object({
  participantId: z.string().regex(PARTICIPANT_ID_PATTERN, 'id looks like otter-42'),
  pickCode: z.string().min(1, 'pick code from your card or the page'),
  picks: z.record(Slot, z.string().min(1)),
});

/**
 * Page variant: keys-create.ts stores a placeholder pseudonym per key from the
 * same animal-number space, so an issued id that equals another key's
 * placeholder would make /api/register hit UNIQUE(pseudonym). Skip those.
 */
const MAX_ISSUE_ATTEMPTS = 100;

const issueFreeId = async (deps: AppDeps): Promise<string> => {
  for (let attempt = 0; attempt < MAX_ISSUE_ATTEMPTS; attempt += 1) {
    const candidate = deps.issuePseudonym();
    if (!(await deps.store.isKeyPseudonym(candidate))) return candidate;
  }
  throw new Error(`no free participant id after ${MAX_ISSUE_ATTEMPTS} draws`);
};

const clientKey = (forwardedFor: string | undefined): string =>
  forwardedFor?.split(',')[0]?.trim() || 'local';

const unknownTalkIds = (deps: AppDeps, picks: Record<string, string>): readonly string[] => {
  if (!deps.program) return [];
  const bySlot = talkIdsBySlot(deps.program.program);
  return Object.entries(picks)
    .filter(([slot, talkId]) => !bySlot.get(slot)?.has(talkId))
    .map(([slot, talkId]) => `${slot}: ${talkId}`);
};

/**
 * Routes without a participant key: health, the blind-pick page, the programme,
 * picks (guarded by the pick code, write-once) and (page variant) id issuing.
 */
export const registerPublicRoutes = (app: Hono, deps: AppDeps): void => {
  const ipLimiter = createRateLimiter(PUBLIC_POSTS_PER_IP_PER_MINUTE, ONE_MINUTE_MS);
  const idLimiter = createRateLimiter(PICKS_PER_ID_PER_MINUTE, ONE_MINUTE_MS);
  const idsPerAddress = createRateLimiter(MAX_IDS_PER_ADDRESS, ID_WINDOW_MS);

  app.get('/api/health', async (c) => {
    const [mlflow, litellm] = await Promise.all([deps.mlflow.health(), deps.litellm.health()]);
    return c.json({
      ok: true,
      mlflow,
      litellm,
      idVariant: deps.env.ID_VARIANT,
      program: deps.program?.path ?? null,
    });
  });

  app.get('/pick', (c) => c.html(renderPickPage(deps.env.ID_VARIANT)));

  app.get('/api/program', (c) => {
    if (!deps.program) return c.json({ ok: false, error: 'no programme file on the server' }, 503);
    return c.json(deps.program.program);
  });

  app.post('/api/ids', async (c) => {
    if (deps.env.ID_VARIANT !== 'page')
      return c.json({ ok: false, error: 'ids are printed on the key slip' }, 404);
    const address = clientKey(c.req.header('x-forwarded-for'));
    if (!ipLimiter.allow(address, deps.now()))
      return c.json({ ok: false, error: 'slow down' }, 429);
    if (!idsPerAddress.allow(address, deps.now()))
      return c.json({ ok: false, error: 'too many ids from this network; tell the floater' }, 429);
    if ((await deps.store.countIssuedIds()) >= MAX_ISSUED_IDS)
      return c.json({ ok: false, error: 'no more ids; tell the floater' }, 503);
    const participantId = await issueFreeId(deps);
    await deps.store.issueId(participantId, deps.now());
    const pickCode = pickCodeFor(deps.env.WORKSHOP_ADMIN_TOKEN, participantId);
    return c.json({ ok: true, participantId, pickCode });
  });

  app.post('/api/picks', async (c) => {
    if (!ipLimiter.allow(clientKey(c.req.header('x-forwarded-for')), deps.now()))
      return c.json({ ok: false, error: 'slow down' }, 429);
    const parsed = PicksBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success)
      return c.json(
        {
          ok: false,
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
        400,
      );
    if (!idLimiter.allow(parsed.data.participantId, deps.now()))
      return c.json({ ok: false, error: 'slow down: too many picks for this id' }, 429);
    const { participantId, pickCode, picks } = parsed.data;
    if (!isValidPickCode(deps.env.WORKSHOP_ADMIN_TOKEN, participantId, pickCode))
      return c.json({ ok: false, error: 'pick code does not match this id' }, 403);
    const unknown = unknownTalkIds(deps, picks);
    if (unknown.length > 0)
      return c.json({ ok: false, error: `unknown talk for ${unknown.join(', ')}` }, 400);
    if (!(await deps.store.savePicks(participantId, picks, deps.now())))
      return c.json({ ok: false, error: 'picks for this id are already saved and final' }, 409);
    return c.json({ ok: true });
  });
};
