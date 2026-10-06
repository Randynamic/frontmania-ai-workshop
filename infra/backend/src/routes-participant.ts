import type { Hono } from 'hono';
import { z } from 'zod';
import { FeedbackInput } from '../../../src/schemas/feedback.js';
import { participantAuth, type AuthVariables } from './auth.js';
import { PARTICIPANT_ID_PATTERN, PROMPT_NAMES, RUN_KINDS, type AppDeps } from './deps.js';
import { MlflowError } from './mlflow.js';
import { ProfileEnvelope, rejectionFor, StoredProfile } from './profile-guard.js';
import { toTraceView } from './trace-view.js';

const TRACE_POLL_MS = 2_000;
const MAX_TRACE_ID_LENGTH = 200;

const RegisterBody = z.object({ participantId: z.string().regex(PARTICIPANT_ID_PATTERN) });
const RunBody = z.object({
  traceId: z.string().min(1).max(MAX_TRACE_ID_LENGTH),
  kind: z.enum(RUN_KINDS),
});
const FeedbackBody = FeedbackInput.extend({ traceId: z.string().min(1).max(MAX_TRACE_ID_LENGTH) });
const PromptName = z.enum(PROMPT_NAMES);

type ParticipantApp = Hono<{ Variables: AuthVariables }>;

const invalid = (issues: z.ZodError['issues']): string =>
  issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');

const waitForTrace = async (deps: AppDeps, traceId: string) => {
  const deadline = deps.now() + deps.env.TRACE_WAIT_MS;
  const attempt = async (): Promise<ReturnType<typeof toTraceView> | undefined> => {
    const raw = await deps.mlflow.getTrace(traceId);
    if (raw) return toTraceView(traceId, raw);
    if (deps.now() >= deadline) return undefined;
    await deps.sleep(TRACE_POLL_MS);
    return attempt();
  };
  return attempt();
};

/** Routes behind the participant key. The key hash maps to the pseudonym; nothing else identifies anyone. */
export const registerParticipantRoutes = (app: ParticipantApp, deps: AppDeps): void => {
  const { store } = deps;
  app.use('/api/auth', participantAuth(store));
  app.use('/api/whoami', participantAuth(store));
  app.use('/api/register', participantAuth(store));
  app.use('/api/profiles', participantAuth(store));
  app.use('/api/runs', participantAuth(store));
  app.use('/api/traces/*', participantAuth(store));
  app.use('/api/feedback', participantAuth(store));
  app.use('/api/prompts/*', participantAuth(store));

  app.get('/api/auth', (c) => c.json({ ok: true }));

  app.get('/api/whoami', async (c) => {
    const record = await store.findKey(c.get('keyHash'));
    if (deps.env.ID_VARIANT === 'page' && record?.linkedAt === null) {
      return c.json(
        {
          ok: false,
          error: 'key not linked: set TALK_PICKER_ID in .env.local and run pnpm run doctor',
        },
        409,
      );
    }
    return c.json({ ok: true, participantId: c.get('participantId') });
  });

  app.post('/api/register', async (c) => {
    if (deps.env.ID_VARIANT !== 'page')
      return c.json({
        ok: true,
        participantId: c.get('participantId'),
        note: 'slip variant: id comes from the key',
      });
    const parsed = RegisterBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ ok: false, error: invalid(parsed.error.issues) }, 400);
    const { participantId } = parsed.data;
    if (!(await store.hasIssuedId(participantId)))
      return c.json(
        { ok: false, error: `id ${participantId} was not issued by the blind-pick page` },
        400,
      );
    const record = await store.findKey(c.get('keyHash'));
    if (record?.linkedAt !== null && record?.pseudonym !== participantId) {
      return c.json(
        { ok: false, error: `this key is already linked to ${record?.pseudonym}` },
        409,
      );
    }
    try {
      await store.linkKey(c.get('keyHash'), participantId, deps.now());
    } catch {
      return c.json({ ok: false, error: `id ${participantId} is linked to another key` }, 409);
    }
    return c.json({ ok: true, participantId });
  });

  app.post('/api/profiles', async (c) => {
    const parsed = ProfileEnvelope.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ ok: false, error: invalid(parsed.error.issues) }, 400);
    const rejection = rejectionFor(parsed.data.profile);
    if (rejection) return c.json({ ok: false, error: rejection }, 400);
    const profile = StoredProfile.safeParse(parsed.data.profile);
    if (!profile.success) return c.json({ ok: false, error: invalid(profile.error.issues) }, 400);
    await store.saveProfile(c.get('participantId'), profile.data, deps.now());
    return c.json({ ok: true });
  });

  app.post('/api/runs', async (c) => {
    const parsed = RunBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ ok: false, error: invalid(parsed.error.issues) }, 400);
    await store.saveRun(parsed.data.traceId, c.get('participantId'), parsed.data.kind, deps.now());
    return c.json({ ok: true });
  });

  app.get('/api/traces/:traceId', async (c) => {
    const traceId = c.req.param('traceId');
    const run = await store.findRun(traceId);
    if (!run || run.participantId !== c.get('participantId'))
      return c.json({ found: false, error: 'not one of your runs' }, 404);
    const view = await waitForTrace(deps, traceId);
    return view
      ? c.json(view)
      : c.json({
          found: false,
          error: `trace ${traceId} not ingested within ${deps.env.TRACE_WAIT_MS} ms`,
        });
  });

  app.post('/api/feedback', async (c) => {
    const parsed = FeedbackBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ ok: false, error: invalid(parsed.error.issues) }, 400);
    const run = await store.findRun(parsed.data.traceId);
    if (!run || run.participantId !== c.get('participantId'))
      return c.json({ ok: false, error: 'traceId is not one of your runs' }, 404);
    const id = await store.saveFeedback(
      { participantId: c.get('participantId'), ...parsed.data },
      deps.now(),
    );
    return c.json({ ok: true, id: String(id) });
  });

  app.get('/api/feedback', async (c) => {
    const traceId = c.req.query('traceId');
    if (!traceId) return c.json({ ok: false, error: 'traceId query required' }, 400);
    const rows = await store.listFeedbackByTrace(traceId, c.get('participantId'));
    return c.json({ ok: true, rows });
  });

  app.get('/api/prompts/:name', async (c) => {
    const name = PromptName.safeParse(c.req.param('name'));
    if (!name.success)
      return c.json({ ok: false, error: `prompt must be one of ${PROMPT_NAMES.join(', ')}` }, 400);
    try {
      return c.json(await deps.mlflow.getPromptByAlias(name.data, 'production'));
    } catch (error) {
      if (error instanceof MlflowError && error.status === 404)
        return c.json({ ok: false, error: error.message }, 404);
      throw error;
    }
  });
};
