import {
  ARCHIVE_DB,
  ARCHIVE_MANIFEST,
  EXPECTED_NODE_MAJOR,
  fail,
  MIN_NODE,
  ok,
  OTLP_SUFFIX,
  PARTICIPANT_ID_KEY,
  PROGRAM_FILE,
  PROGRAM_FIXTURE,
  REQUIRED_ENV_KEYS,
  REQUIRED_MODEL_ALIASES,
  warn,
  type CheckResult,
  type DoctorEnvironment,
  type FetchOutcome,
} from './types.js';

const HTTP_CONFLICT = 409;

const parseVersion = (version: string): { major: number; minor: number } => {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  return { major, minor };
};

const trimSlash = (url: string): string => url.replace(/\/$/, '');

export const checkNode = (env: DoctorEnvironment): CheckResult => {
  const { major, minor } = parseVersion(env.nodeVersion);
  const isTooOld = major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor);
  if (isTooOld) {
    return fail(
      'node',
      `${env.nodeVersion} is below ${MIN_NODE.major}.${MIN_NODE.minor}; run: nvm install`,
    );
  }
  if (major !== EXPECTED_NODE_MAJOR) {
    return warn('node', `${env.nodeVersion}: Node ${major} works but the workshop is tested on 22`);
  }
  return ok('node', env.nodeVersion);
};

export const checkPnpm = (env: DoctorEnvironment): CheckResult => {
  const expected = env.packageManager.replace(/^pnpm@/, '');
  if (!env.pnpmVersion) return fail('pnpm', 'not found; run: corepack enable');
  if (env.pnpmVersion !== expected) {
    return fail('pnpm', `${env.pnpmVersion} found, ${expected} expected; run: corepack enable`);
  }
  return ok('pnpm', env.pnpmVersion);
};

export const checkEnvKeys = (env: DoctorEnvironment): CheckResult => {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env.env[key]?.trim());
  if (missing.length === 0) return ok('.env', `${REQUIRED_ENV_KEYS.length} keys present`);
  return fail(
    '.env',
    `missing ${missing.join(', ')}; copy .env.example to .env and paste the key from your card`,
  );
};

/** The committed index must have been built with the embedding the run will query it with. */
const archiveIndexMode = (env: DoctorEnvironment): { mode?: string; problem?: string } => {
  const text = env.readFile(ARCHIVE_MANIFEST);
  if (text === undefined) return { problem: `${ARCHIVE_MANIFEST} missing; run: pnpm ingest` };
  try {
    const mode = (JSON.parse(text) as { mode?: unknown }).mode;
    return typeof mode === 'string' ? { mode } : { problem: `${ARCHIVE_MANIFEST} has no mode` };
  } catch {
    return { problem: `${ARCHIVE_MANIFEST} is not JSON; run: pnpm ingest` };
  }
};

export const checkData = (env: DoctorEnvironment): CheckResult => {
  const program = env.fileExists(PROGRAM_FILE)
    ? PROGRAM_FILE
    : env.fileExists(PROGRAM_FIXTURE)
      ? `${PROGRAM_FIXTURE} (fixture)`
      : undefined;
  if (!program)
    return fail('data', `${PROGRAM_FILE} and its fixture are both missing; git checkout the file`);
  if (!env.fileExists(ARCHIVE_DB)) return fail('data', `${ARCHIVE_DB} missing; run: pnpm ingest`);
  const { mode, problem } = archiveIndexMode(env);
  if (problem) return fail('data', problem);
  const isLive = env.env.MODEL_MODE !== 'mock';
  if (isLive && mode !== 'live') {
    return fail(
      'data',
      `${ARCHIVE_DB} was built in ${mode} mode but MODEL_MODE is live; ask the floater (trainer: pnpm ingest with a real key, commit archive.db and the manifest)`,
    );
  }
  return ok('data', `${program}, ${ARCHIVE_DB} (${mode} index)`);
};

const bearer = (env: DoctorEnvironment): Record<string, string> => ({
  Authorization: `Bearer ${env.env.PROXY_API_KEY ?? ''}`,
});

const describeFailure = (outcome: FetchOutcome, unauthorizedHint: string): string => {
  if (outcome.kind === 'network-error') return `unreachable (${outcome.message}); ask the floater`;
  if (outcome.status === 401 || outcome.status === 403)
    return `${outcome.status}: ${unauthorizedHint}`;
  return `HTTP ${outcome.status}; ask the floater`;
};

const modelIds = (body: unknown): readonly string[] => {
  const data = (body as { data?: { id?: unknown }[] } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return data.map((m) => m.id).filter((id): id is string => typeof id === 'string');
};

export const checkProxy = async (env: DoctorEnvironment): Promise<CheckResult> => {
  const base = env.env.PROXY_BASE_URL ?? '';
  if (!base) return fail('proxy', 'PROXY_BASE_URL not set');
  const outcome = await env.fetchJson(`${trimSlash(base)}/models`, { headers: bearer(env) });
  if (outcome.kind !== 'response' || outcome.status !== 200) {
    return fail('proxy', describeFailure(outcome, 'wrong key; check PROXY_API_KEY in .env'));
  }
  const ids = modelIds(outcome.body);
  const missing = REQUIRED_MODEL_ALIASES.filter((alias) => !ids.includes(alias));
  if (missing.length > 0)
    return fail('proxy', `models missing: ${missing.join(', ')}; ask the floater`);
  return ok('proxy', `${REQUIRED_MODEL_ALIASES.join(', ')} available`);
};

export const checkBackend = async (env: DoctorEnvironment): Promise<CheckResult> => {
  const base = env.env.WORKSHOP_BACKEND_URL ?? '';
  if (!base) return fail('backend', 'WORKSHOP_BACKEND_URL not set');
  const outcome = await env.fetchJson(`${trimSlash(base)}/api/health`);
  if (outcome.kind !== 'response' || outcome.status !== 200) {
    return fail('backend', describeFailure(outcome, 'backend refused the request'));
  }
  const body = outcome.body as { ok?: boolean; mlflow?: boolean } | undefined;
  if (body?.ok !== true) return fail('backend', 'health reports not ok; ask the floater');
  if (body.mlflow !== true) return fail('backend', 'backend up but MLflow down; ask the floater');
  return ok('backend', 'ok, mlflow ok');
};

export const checkTracing = async (env: DoctorEnvironment): Promise<CheckResult> => {
  const endpoint = env.env.MLFLOW_OTLP_ENDPOINT ?? '';
  if (!endpoint.endsWith(OTLP_SUFFIX)) {
    return fail('tracing', `MLFLOW_OTLP_ENDPOINT must end with ${OTLP_SUFFIX}`);
  }
  const healthUrl = `${endpoint.slice(0, -OTLP_SUFFIX.length)}/health`;
  const outcome = await env.fetchJson(healthUrl, { headers: bearer(env) });
  if (outcome.kind !== 'response' || outcome.status !== 200) {
    return fail(
      'tracing',
      describeFailure(outcome, 'gateway rejected the key; check PROXY_API_KEY'),
    );
  }
  return ok('tracing', 'gateway and MLflow reachable');
};

const registerIfConfigured = async (
  env: DoctorEnvironment,
  base: string,
): Promise<CheckResult | undefined> => {
  const participantId = env.env[PARTICIPANT_ID_KEY]?.trim();
  if (!participantId) return undefined;
  const outcome = await env.fetchJson(`${base}/api/register`, {
    method: 'POST',
    headers: bearer(env),
    body: { participantId },
  });
  if (outcome.kind === 'response' && outcome.status === 200) return undefined;
  const reason =
    outcome.kind === 'response'
      ? String((outcome.body as { error?: unknown } | undefined)?.error ?? `HTTP ${outcome.status}`)
      : outcome.message;
  return fail('identity', `could not link ${participantId}: ${reason}`);
};

/**
 * Slip variant: whoami derives the id from the key. Page variant: TALK_PICKER_ID
 * from .env.local is registered once, then whoami returns it; 409 means unlinked.
 */
export const checkIdentity = async (
  env: DoctorEnvironment,
): Promise<{ result: CheckResult; participantId?: string }> => {
  const base = trimSlash(env.env.WORKSHOP_BACKEND_URL ?? '');
  const registration = await registerIfConfigured(env, base);
  if (registration) return { result: registration };
  const outcome = await env.fetchJson(`${base}/api/whoami`, { headers: bearer(env) });
  if (outcome.kind === 'response' && outcome.status === HTTP_CONFLICT) {
    return {
      result: fail(
        'identity',
        `enter the id from the blind-pick page in .env.local as ${PARTICIPANT_ID_KEY}=<id>`,
      ),
    };
  }
  if (outcome.kind !== 'response' || outcome.status !== 200) {
    return {
      result: fail('identity', describeFailure(outcome, 'key unknown or revoked; ask the floater')),
    };
  }
  const participantId = (outcome.body as { participantId?: unknown } | undefined)?.participantId;
  if (typeof participantId !== 'string' || participantId.length === 0) {
    return { result: fail('identity', 'backend returned no participant id; ask the floater') };
  }
  return { result: ok('identity', participantId), participantId };
};

export interface DoctorReport {
  readonly results: readonly CheckResult[];
  readonly participantId?: string;
  readonly exitCode: 0 | 1;
}

/** Runs the local checks first, then the four network checks concurrently. */
export const runDoctor = async (env: DoctorEnvironment): Promise<DoctorReport> => {
  const local = [checkNode(env), checkPnpm(env), checkEnvKeys(env), checkData(env)];
  const [proxy, backend, tracing, identity] = await Promise.all([
    checkProxy(env),
    checkBackend(env),
    checkTracing(env),
    checkIdentity(env),
  ]);
  const results = [...local, proxy, backend, tracing, identity.result];
  const hasFailure = results.some((result) => result.status === 'FAIL');
  return {
    results,
    exitCode: hasFailure ? 1 : 0,
    ...(identity.participantId ? { participantId: identity.participantId } : {}),
  };
};

export const formatLine = (result: CheckResult): string =>
  `${result.status.padEnd(4)} ${result.name.padEnd(9)} ${result.detail}`;

export const formatIdentityLine = (participantId: string): string =>
  `You are ${participantId}. Use this id on the blind-pick page.`;
