import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { keyRegistrationBody } from '../../scripts/lib/key-registration.js';
import { createApp, type BackendApp } from './app.js';
import { pickCodeFor } from './pick-code.js';
import { MAX_IDS_PER_ADDRESS, MAX_ISSUED_IDS } from './routes-public.js';
import {
  ADMIN_TOKEN,
  asAdmin,
  asParticipant,
  jsonBody,
  PARTICIPANT_ID,
  testDeps,
  type TestDeps,
} from './test-helpers.js';

/** A profile in the exact shape of src/schemas/profile.ts, as `pnpm run profile` posts it. */
const VALID_PROFILE = {
  role: 'front-end developer at a public-sector organisation',
  seniority: 'senior',
  stack: ['TypeScript', 'Angular'],
  interests: ['accessibility in real applications'],
  avoid: ['crypto or Web3'],
} as const;

let deps: TestDeps;
let app: BackendApp;

beforeEach(async () => {
  deps = await testDeps();
  app = createApp(deps);
});
afterEach(() => deps.store.close());

const body = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;
const codeFor = (participantId: string): string => pickCodeFor(ADMIN_TOKEN, participantId);

describe('public routes', () => {
  test('health reports both services, the id variant and the programme source', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({
      ok: true,
      mlflow: true,
      litellm: true,
      idVariant: 'slip',
      program: 'fixture',
    });
  });

  test('pick page and programme need no key', async () => {
    const page = await app.request('/pick');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Pick your afternoon');
    const program = await body(await app.request('/api/program'));
    expect(program['slots']).toEqual(['14:15', '15:30', '16:30']);
  });

  test('picks validate the id, the talk ids and the slot set, then persist', async () => {
    expect(
      (await app.request('/api/picks', jsonBody({ participantId: 'Otter 42', picks: {} }))).status,
    ).toBe(400);
    const wrongTalk = await app.request(
      '/api/picks',
      jsonBody({
        participantId: 'otter-42',
        pickCode: codeFor('otter-42'),
        picks: { '14:15': 't2', '15:30': 't2', '16:30': 't3' },
      }),
    );
    expect(wrongTalk.status).toBe(400);
    expect((await body(wrongTalk))['error']).toContain('14:15: t2');
    const ok = await app.request(
      '/api/picks',
      jsonBody({
        participantId: 'otter-42',
        pickCode: codeFor('otter-42'),
        picks: { '14:15': 't1', '15:30': 't2', '16:30': 't3' },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await deps.store.getPicks('otter-42')).toEqual({
      '14:15': 't1',
      '15:30': 't2',
      '16:30': 't3',
    });
  });

  const PICKS = { '14:15': 't1', '15:30': 't2', '16:30': 't3' };
  const ROOM_WIFI = { headers: { 'x-forwarded-for': '10.0.0.9, caddy' } };
  const pickAs = (participantId: string, pickCode = codeFor(participantId), picks = PICKS) =>
    app.request('/api/picks', jsonBody({ participantId, pickCode, picks }, ROOM_WIFI));

  test('someone who only knows an id cannot save picks for it', async () => {
    const noCode = await app.request(
      '/api/picks',
      jsonBody({ participantId: 'otter-42', picks: PICKS }),
    );
    expect(noCode.status).toBe(400);
    const otherIdsCode = await pickAs('otter-42', codeFor('otter-43'));
    expect(otherIdsCode.status).toBe(403);
    expect(await deps.store.getPicks('otter-42')).toBeNull();
  });

  test('picks are final once saved: a second submit, even with the right code, is 409', async () => {
    expect((await pickAs('otter-42')).status).toBe(200);
    const overwrite = await pickAs('otter-42', codeFor('otter-42'), {
      '14:15': 't1',
      '15:30': 't2',
      '16:30': 't3',
    });
    expect(overwrite.status).toBe(409);
    expect((await body(overwrite))['error']).toContain('final');
    expect(await deps.store.getPicks('otter-42')).toEqual(PICKS);
  });

  test('40 participants behind one conference address all submit their pick in one minute', async () => {
    const statuses = await Promise.all(
      Array.from({ length: 40 }, (_, i) => pickAs(`otter-${i + 1}`)),
    );
    expect(statuses.map((r) => r.status)).toEqual(Array.from({ length: 40 }, () => 200));
  });

  test('picks are rate limited per participant id, not per address', async () => {
    const same = await Promise.all(Array.from({ length: 21 }, () => pickAs('otter-42')));
    expect(same.filter((r) => r.status === 429)).toHaveLength(1);
    expect(same.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await pickAs('otter-43')).status).toBe(200);
  });

  test('a flood from one address is still capped', async () => {
    const flood = await Promise.all(Array.from({ length: 601 }, (_, i) => pickAs(`flood-${i}`)));
    expect(flood.filter((r) => r.status === 429)).toHaveLength(1);
  });

  test('ids are only issued in the page variant', async () => {
    expect((await app.request('/api/ids', { method: 'POST' })).status).toBe(404);
    const pageDeps = await testDeps('page');
    const pageApp = createApp(pageDeps);
    const res = await pageApp.request('/api/ids', { method: 'POST' });
    expect(await body(res)).toEqual({
      ok: true,
      participantId: 'heron-10',
      pickCode: codeFor('heron-10'),
    });
    expect(await pageDeps.store.hasIssuedId('heron-10')).toBe(true);
    pageDeps.store.close();
  });

  test('page variant: one address gets at most MAX_IDS_PER_ADDRESS ids, others still get one', async () => {
    const pageDeps = await testDeps('page');
    const pageApp = createApp(pageDeps);
    const from = (address: string) => ({ method: 'POST', headers: { 'x-forwarded-for': address } });
    for (let i = 0; i < MAX_IDS_PER_ADDRESS; i += 1)
      expect((await pageApp.request('/api/ids', from('10.0.0.66'))).status).toBe(200);
    expect((await pageApp.request('/api/ids', from('10.0.0.66'))).status).toBe(429);
    expect((await pageApp.request('/api/ids', from('10.0.0.7'))).status).toBe(200);
    expect(await pageDeps.store.countIssuedIds()).toBe(MAX_IDS_PER_ADDRESS + 1);
    pageDeps.store.close();
  });

  test('page variant: the pool stops at MAX_ISSUED_IDS with 503 across addresses', async () => {
    const pageDeps = await testDeps('page');
    const pageApp = createApp(pageDeps);
    const from = (i: number) => ({
      method: 'POST',
      headers: { 'x-forwarded-for': `10.1.0.${i % 7}` },
    });
    for (let i = 0; i < MAX_ISSUED_IDS; i += 1)
      expect((await pageApp.request('/api/ids', from(i))).status).toBe(200);
    const exhausted = await pageApp.request('/api/ids', from(MAX_ISSUED_IDS));
    expect(exhausted.status).toBe(503);
    expect(await pageDeps.store.countIssuedIds()).toBe(MAX_ISSUED_IDS);
    pageDeps.store.close();
  });
});

describe('participant auth', () => {
  test('rejects a missing, unknown or revoked key and accepts the right one', async () => {
    expect((await app.request('/api/auth')).status).toBe(401);
    expect(
      (await app.request('/api/auth', { headers: { authorization: 'Bearer sk-nope' } })).status,
    ).toBe(401);
    expect((await app.request('/api/auth', asParticipant())).status).toBe(200);
    await deps.store.revokeAllKeys();
    const revoked = await app.request('/api/auth', asParticipant());
    expect(revoked.status).toBe(401);
    expect((await body(revoked))['error']).toContain('revoked');
  });

  test('whoami returns the pseudonym in the slip variant', async () => {
    expect(await body(await app.request('/api/whoami', asParticipant()))).toEqual({
      ok: true,
      participantId: PARTICIPANT_ID,
    });
    const register = await app.request(
      '/api/register',
      asParticipant(jsonBody({ participantId: 'x-1' })),
    );
    expect((await body(register))['participantId']).toBe(PARTICIPANT_ID);
  });

  test('page variant: whoami is 409 until the issued id is registered', async () => {
    const pageDeps = await testDeps('page');
    const pageApp = createApp(pageDeps);
    expect((await pageApp.request('/api/whoami', asParticipant())).status).toBe(409);
    const notIssued = await pageApp.request(
      '/api/register',
      asParticipant(jsonBody({ participantId: 'lynx-77' })),
    );
    expect(notIssued.status).toBe(400);
    const { participantId } = (await (
      await pageApp.request('/api/ids', { method: 'POST' })
    ).json()) as { participantId: string };
    expect(
      (await pageApp.request('/api/register', asParticipant(jsonBody({ participantId })))).status,
    ).toBe(200);
    expect(
      (await pageApp.request('/api/register', asParticipant(jsonBody({ participantId })))).status,
    ).toBe(200);
    expect(await body(await pageApp.request('/api/whoami', asParticipant()))).toEqual({
      ok: true,
      participantId,
    });
    const anotherIssuedId = (
      (await (await pageApp.request('/api/ids', { method: 'POST' })).json()) as {
        participantId: string;
      }
    ).participantId;
    const other = await pageApp.request(
      '/api/register',
      asParticipant(jsonBody({ participantId: anotherIssuedId })),
    );
    expect(other.status).toBe(409);
    pageDeps.store.close();
  });
});

describe('keys registered the way keys-create.ts posts them', () => {
  const FRESH_KEY = 'sk-fresh-card-key';
  const asFresh = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${FRESH_KEY}`,
    },
  });

  test('page variant: the posted key starts unlinked, whoami is 409, register links it', async () => {
    const pageDeps = await testDeps('page');
    const pageApp = createApp(pageDeps);
    const posted = await pageApp.request(
      '/api/admin/keys',
      asAdmin(jsonBody(keyRegistrationBody('lynx-77', FRESH_KEY, 'page'))),
    );
    expect(posted.status).toBe(200);
    expect((await pageApp.request('/api/whoami', asFresh())).status).toBe(409);
    const { participantId } = (await (
      await pageApp.request('/api/ids', { method: 'POST' })
    ).json()) as { participantId: string };
    const registered = await pageApp.request('/api/register', asFresh(jsonBody({ participantId })));
    expect(registered.status).toBe(200);
    expect(await body(await pageApp.request('/api/whoami', asFresh()))).toEqual({
      ok: true,
      participantId,
    });
    pageDeps.store.close();
  });

  test("page variant: the page never issues an id that is another key's placeholder", async () => {
    // Arrange: two keys whose placeholders sit in the ids the page would draw next (heron-10, heron-11, ...)
    const pageDeps = await testDeps('page');
    const pageApp = createApp(pageDeps);
    const OTHER_KEY = 'sk-other-card-key';
    for (const [placeholder, key] of [
      ['heron-10', OTHER_KEY],
      ['heron-11', FRESH_KEY],
    ] as const) {
      const posted = await pageApp.request(
        '/api/admin/keys',
        asAdmin(jsonBody(keyRegistrationBody(placeholder, key, 'page'))),
      );
      expect(posted.status).toBe(200);
    }

    // Act: the page issues an id and the fresh key registers it
    const { participantId } = (await (
      await pageApp.request('/api/ids', { method: 'POST' })
    ).json()) as { participantId: string };
    const registered = await pageApp.request('/api/register', asFresh(jsonBody({ participantId })));

    // Assert: the issued id skipped both placeholders and links without a 409
    expect(participantId).toBe('heron-12');
    expect(registered.status).toBe(200);
    expect(await body(await pageApp.request('/api/whoami', asFresh()))).toEqual({
      ok: true,
      participantId,
    });
    pageDeps.store.close();
  });

  test('slip variant: the posted key is linked to its printed pseudonym at once', async () => {
    const posted = await app.request(
      '/api/admin/keys',
      asAdmin(jsonBody(keyRegistrationBody('lynx-77', FRESH_KEY, 'slip'))),
    );
    expect(posted.status).toBe(200);
    expect(await body(await app.request('/api/whoami', asFresh()))).toEqual({
      ok: true,
      participantId: 'lynx-77',
    });
  });

  test('a body without linked defaults to linked (slip), so page keys must say linked: false', async () => {
    const pageDeps = await testDeps('page');
    const pageApp = createApp(pageDeps);
    await pageApp.request(
      '/api/admin/keys',
      asAdmin(
        jsonBody({
          pseudonym: 'vole-31',
          keyHash: keyRegistrationBody('vole-31', FRESH_KEY, 'slip').keyHash,
        }),
      ),
    );
    expect((await pageApp.request('/api/whoami', asFresh())).status).toBe(200);
    pageDeps.store.close();
  });
});

describe('profiles, runs, traces, feedback', () => {
  const registerRun = (traceId: string, kind = 'plan') =>
    app.request('/api/runs', asParticipant(jsonBody({ traceId, kind })));

  test('profiles with identity fields are refused, clean ones stored', async () => {
    const bad = await app.request(
      '/api/profiles',
      asParticipant(jsonBody({ profile: { role: 'dev', email: 'x@y.z' } })),
    );
    expect(bad.status).toBe(400);
    expect((await body(bad))['error']).toContain('email');
    expect(
      (await app.request('/api/profiles', asParticipant(jsonBody({ profile: VALID_PROFILE }))))
        .status,
    ).toBe(200);
    expect((await app.request('/api/profiles', asParticipant(jsonBody({ nope: 1 })))).status).toBe(
      400,
    );
    expect((await deps.store.exportAll())[0]?.profile).toEqual(VALID_PROFILE);
  });

  test('profiles outside the strict Profile shape are refused and nothing is stored', async () => {
    const cvSentence =
      'Senior Frontend Engineer who rebuilt the checkout of a large Dutch web shop in Next.js';
    for (const profile of [
      { role: 'dev' },
      { ...VALID_PROFILE, role: cvSentence },
      { ...VALID_PROFILE, stack: [cvSentence] },
      { ...VALID_PROFILE, summary: 'anything else' },
      { ...VALID_PROFILE, stack: Array.from({ length: 11 }, (_, i) => `tool ${i}`) },
    ]) {
      const response = await app.request('/api/profiles', asParticipant(jsonBody({ profile })));
      expect(response.status, JSON.stringify(profile)).toBe(400);
    }
    expect(await deps.store.exportAll()).toEqual([]);
  });

  test('traces are readable only for own runs and wait for ingestion', async () => {
    expect((await registerRun('tr-1')).status).toBe(200);
    expect(
      (await app.request('/api/runs', asParticipant(jsonBody({ traceId: 'tr-2', kind: 'nope' }))))
        .status,
    ).toBe(400);
    expect((await app.request('/api/traces/tr-9', asParticipant())).status).toBe(404);
    const timedOut = await body(await app.request('/api/traces/tr-1', asParticipant()));
    expect(timedOut['found']).toBe(false);
    deps.mlflowState.traces['tr-1'] = {
      spans: [
        {
          name: 'plan',
          start_time_unix_nano: '1000000',
          end_time_unix_nano: '3000000',
          attributes: [{ key: 'gen_ai.usage.total_tokens', value: { int_value: '42' } }],
        },
      ],
    };
    const found = await body(await app.request('/api/traces/tr-1', asParticipant()));
    expect(found).toMatchObject({ found: true, traceId: 'tr-1', tokens: 42, latencyMs: 2 });
  });

  test('feedback is stored against own runs and listed by trace', async () => {
    await registerRun('tr-1');
    const foreign = await app.request(
      '/api/feedback',
      asParticipant(jsonBody({ traceId: 'tr-x', slot: '14:15', thumb: 'up', reason: 'r' })),
    );
    expect(foreign.status).toBe(404);
    const invalid = await app.request(
      '/api/feedback',
      asParticipant(jsonBody({ traceId: 'tr-1', slot: '13:30', thumb: 'up', reason: 'r' })),
    );
    expect(invalid.status).toBe(400);
    const ok = await body(
      await app.request(
        '/api/feedback',
        asParticipant(
          jsonBody({ traceId: 'tr-1', slot: '14:15', thumb: 'up', reason: 'good fit' }),
        ),
      ),
    );
    expect(ok).toEqual({ ok: true, id: '1' });
    expect((await app.request('/api/feedback', asParticipant())).status).toBe(400);
    const rows = (await body(await app.request('/api/feedback?traceId=tr-1', asParticipant())))[
      'rows'
    ] as { slot: string; attachedAt: unknown }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slot: '14:15', attachedAt: null });
  });

  test('prompts come from the registry by alias and unknown names are refused', async () => {
    expect((await app.request('/api/prompts/system', asParticipant())).status).toBe(400);
    expect(await body(await app.request('/api/prompts/ranker', asParticipant()))).toEqual({
      name: 'ranker',
      alias: 'production',
      version: '4',
      template: 'Rank {{talks}} for {{profile}}',
    });
    expect((await app.request('/api/prompts/tip', asParticipant())).status).toBe(404);
    deps.mlflowState.down = true;
    expect((await app.request('/api/prompts/ranker', asParticipant())).status).toBe(500);
  });
});

describe('admin routes', () => {
  test('need the admin token', async () => {
    expect((await app.request('/api/admin/stats')).status).toBe(401);
    expect((await app.request('/api/admin/stats', asParticipant())).status).toBe(401);
    expect((await app.request('/api/admin/stats', asAdmin())).status).toBe(200);
  });

  test('keys can be listed, added, revoked; data exported and wiped', async () => {
    expect((await body(await app.request('/api/admin/keys', asAdmin())))['pseudonyms']).toEqual([
      PARTICIPANT_ID,
    ]);
    expect(
      (
        await app.request(
          '/api/admin/keys',
          asAdmin(jsonBody({ pseudonym: 'lynx-11', keyHash: 'nothex' })),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          '/api/admin/keys',
          asAdmin(jsonBody({ pseudonym: 'lynx-11', keyHash: 'b'.repeat(64) })),
        )
      ).status,
    ).toBe(200);
    await app.request('/api/profiles', asParticipant(jsonBody({ profile: VALID_PROFILE })));
    const exported = await (await app.request('/api/admin/export', asAdmin())).text();
    expect(exported.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(exported)).toMatchObject({
      participantId: PARTICIPANT_ID,
      picks: null,
      feedback: [],
    });
    expect(
      await body(await app.request('/api/admin/keys/revoke-all', asAdmin({ method: 'POST' }))),
    ).toEqual({ ok: true, revoked: 2 });
    const stats = await body(await app.request('/api/admin/stats', asAdmin()));
    expect(stats).toMatchObject({ keys: 2, keysRevoked: 2, profiles: 1 });
    const wiped = await body(await app.request('/api/admin/wipe', asAdmin({ method: 'POST' })));
    expect(wiped['deleted']).toBe(3);
    expect(await body(await app.request('/api/admin/stats', asAdmin()))).toMatchObject({
      keys: 0,
      profiles: 0,
    });
  });

  test('unknown routes answer json 404', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect((await body(res))['error']).toContain('/nope');
  });
});
