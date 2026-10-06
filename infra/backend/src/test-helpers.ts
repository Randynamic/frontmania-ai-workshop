import { hashKey } from './auth.js';
import type { AppDeps } from './deps.js';
import { readBackendEnv, type IdVariant } from './env.js';
import { LitellmClient } from './litellm.js';
import { MlflowClient, type FetchLike } from './mlflow.js';
import type { LoadedProgram } from './program.js';
import { Store } from './store.js';

export const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
export const PARTICIPANT_KEY = 'sk-participant-otter';
export const PARTICIPANT_ID = 'otter-42';

/** In-memory stand-in for the MLflow server, served through the real MlflowClient. */
export interface FakeMlflowState {
  traces: Record<
    string,
    { trace_info?: Record<string, unknown>; spans?: Record<string, unknown>[] }
  >;
  assessments: unknown[];
  failAssessments: boolean;
  down: boolean;
}

const jsonResponse = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const fakeMlflowFetch =
  (state: FakeMlflowState): FetchLike =>
  async (url, init) => {
    if (state.down) throw new Error('mlflow down');
    if (url.endsWith('/health')) return new Response('OK', { status: 200 });
    if (url.includes('/traces/get?trace_id=')) {
      const id = decodeURIComponent(url.split('trace_id=')[1] ?? '');
      const trace = state.traces[id];
      return trace ? jsonResponse(200, { trace }) : jsonResponse(404, { message: 'not found' });
    }
    if (url.endsWith('/assessments')) {
      if (state.failAssessments) return jsonResponse(404, { message: 'trace not found' });
      state.assessments = [...state.assessments, JSON.parse(String(init?.body))];
      return jsonResponse(200, {});
    }
    if (url.includes('/registered-models/alias')) {
      return url.includes('name=tip')
        ? jsonResponse(404, {})
        : jsonResponse(200, { model_version: { version: '4' } });
    }
    if (url.includes('/model-versions/get')) {
      return jsonResponse(200, {
        model_version: {
          tags: [{ key: 'mlflow.prompt.text', value: 'Rank {{talks}} for {{profile}}' }],
        },
      });
    }
    if (url.endsWith('/traces/search'))
      return jsonResponse(200, {
        traces: Object.keys(state.traces).map((trace_id) => ({ trace_id })),
      });
    if (url.endsWith('/delete-traces')) {
      const deleted = Object.keys(state.traces).length;
      state.traces = {};
      return jsonResponse(200, { traces_deleted: deleted });
    }
    return jsonResponse(500, { message: `unhandled ${url}` });
  };

export const testProgram = (): LoadedProgram => ({
  path: 'fixture',
  isFixture: true,
  program: {
    fixture: true,
    slots: ['14:15', '15:30', '16:30'],
    talks: [
      { id: 't1', title: 'Server components', slot: '14:15', speakers: ['A'] },
      { id: 't2', title: 'Accessibility', slot: '15:30', speakers: ['B'] },
      { id: 't3', title: 'Edge rendering', slot: '16:30', speakers: [] },
    ],
  },
});

export interface TestDeps extends AppDeps {
  readonly mlflowState: FakeMlflowState;
  readonly clock: { now: number };
}

export const testDeps = async (variant: IdVariant = 'slip'): Promise<TestDeps> => {
  const mlflowState: FakeMlflowState = {
    traces: {},
    assessments: [],
    failAssessments: false,
    down: false,
  };
  const clock = { now: 1_000 };
  const store = await Store.open(':memory:');
  await store.addKey(hashKey(PARTICIPANT_KEY), PARTICIPANT_ID, variant === 'slip', clock.now);
  let issued = 0;
  return {
    env: readBackendEnv({
      WORKSHOP_ADMIN_TOKEN: ADMIN_TOKEN,
      ID_VARIANT: variant,
      TRACE_WAIT_MS: '10',
    }),
    store,
    mlflow: new MlflowClient({
      baseUrl: 'http://mlflow:5000',
      experimentId: '7',
      fetchImpl: fakeMlflowFetch(mlflowState),
    }),
    litellm: new LitellmClient({
      baseUrl: 'http://litellm:4000',
      masterKey: 'sk-master',
      fetchImpl: async () => new Response('{}', { status: 200 }),
    }),
    program: testProgram(),
    issuePseudonym: () => `heron-${10 + issued++}`,
    now: () => clock.now,
    sleep: async () => {
      clock.now += 5_000;
    },
    mlflowState,
    clock,
  };
};

export const asParticipant = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    ...(init.headers as Record<string, string> | undefined),
    authorization: `Bearer ${PARTICIPANT_KEY}`,
  },
});

export const asAdmin = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    ...(init.headers as Record<string, string> | undefined),
    authorization: `Bearer ${ADMIN_TOKEN}`,
  },
});

export const jsonBody = (body: unknown, init: RequestInit = {}): RequestInit => ({
  ...init,
  method: 'POST',
  headers: {
    ...(init.headers as Record<string, string> | undefined),
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});
