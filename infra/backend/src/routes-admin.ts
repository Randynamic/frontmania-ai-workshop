import type { Hono } from 'hono';
import { z } from 'zod';
import { adminAuth } from './auth.js';
import type { AppDeps } from './deps.js';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const AddKeyBody = z.object({
  pseudonym: z.string().min(1),
  keyHash: z.string().regex(SHA256_HEX, 'keyHash must be sha256 hex'),
  linked: z.boolean().default(true),
});

/** Trainer routes behind WORKSHOP_ADMIN_TOKEN; called by infra/scripts and optimize/. */
export const registerAdminRoutes = (app: Hono, deps: AppDeps): void => {
  const { store } = deps;
  app.use('/api/admin/*', adminAuth(deps.env.WORKSHOP_ADMIN_TOKEN));

  app.get('/api/admin/stats', async (c) => c.json({ ok: true, ...(await store.stats()) }));

  app.get('/api/admin/export', async (c) => {
    const rows = await store.exportAll();
    return c.text(rows.map((row) => JSON.stringify(row)).join('\n'), 200, {
      'content-type': 'application/x-ndjson',
    });
  });

  app.get('/api/admin/keys', async (c) =>
    c.json({ ok: true, pseudonyms: await store.listPseudonyms() }),
  );

  app.post('/api/admin/keys', async (c) => {
    const parsed = AddKeyBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success)
      return c.json(
        { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') },
        400,
      );
    await store.addKey(parsed.data.keyHash, parsed.data.pseudonym, parsed.data.linked, deps.now());
    return c.json({ ok: true });
  });

  app.post('/api/admin/keys/revoke-all', async (c) =>
    c.json({ ok: true, revoked: await store.revokeAllKeys(deps.now()) }),
  );

  app.post('/api/admin/wipe', async (c) => c.json({ ok: true, deleted: await store.wipe() }));
};
