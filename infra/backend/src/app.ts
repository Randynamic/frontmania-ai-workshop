import { Hono } from 'hono';
import type { AuthVariables } from './auth.js';
import type { AppDeps } from './deps.js';
import { registerAdminRoutes } from './routes-admin.js';
import { registerParticipantRoutes } from './routes-participant.js';
import { registerPublicRoutes } from './routes-public.js';

export type BackendApp = Hono<{ Variables: AuthVariables }>;

/** Builds the Hono app from injected dependencies; server.ts wires the real ones. */
export const createApp = (deps: AppDeps): BackendApp => {
  const app: BackendApp = new Hono();
  registerPublicRoutes(app as unknown as Hono, deps);
  registerParticipantRoutes(app, deps);
  registerAdminRoutes(app as unknown as Hono, deps);
  app.notFound((c) => c.json({ ok: false, error: `no route ${c.req.method} ${c.req.path}` }, 404));
  app.onError((error, c) => {
    console.error(`[backend] ${c.req.method} ${c.req.path}: ${error.message}`);
    return c.json({ ok: false, error: 'internal error; tell the floater' }, 500);
  });
  return app;
};
