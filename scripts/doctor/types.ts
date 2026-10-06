export type CheckStatus = 'OK' | 'FAIL' | 'WARN';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export const ok = (name: string, detail: string): CheckResult => ({ name, status: 'OK', detail });
export const fail = (name: string, detail: string): CheckResult => ({
  name,
  status: 'FAIL',
  detail,
});
export const warn = (name: string, detail: string): CheckResult => ({
  name,
  status: 'WARN',
  detail,
});

export type FetchOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'network-error'; readonly message: string };

export interface FetchInit {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

/** Everything the checks read from the outside world, injected so tests stay offline. */
export interface DoctorEnvironment {
  readonly nodeVersion: string;
  readonly pnpmVersion: string | undefined;
  readonly packageManager: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fileExists: (relativePath: string) => boolean;
  /** Text of a repo file, or undefined when it is missing or unreadable. */
  readonly readFile: (relativePath: string) => string | undefined;
  readonly fetchJson: (url: string, init?: FetchInit) => Promise<FetchOutcome>;
}

export const REQUIRED_ENV_KEYS = [
  'PROXY_API_KEY',
  'PROXY_BASE_URL',
  'WORKSHOP_BACKEND_URL',
  'MLFLOW_OTLP_ENDPOINT',
] as const;

/** Page variant only: the id shown by the blind-pick page, kept in the git-ignored .env.local. */
export const PARTICIPANT_ID_KEY = 'TALK_PICKER_ID';

export const REQUIRED_MODEL_ALIASES = ['talk-picker-task', 'talk-picker-embed'] as const;
export const MIN_NODE = { major: 22, minor: 13 } as const;
export const EXPECTED_NODE_MAJOR = 22;
export const PROGRAM_FILE = 'data/program-2026.json';
export const PROGRAM_FIXTURE = 'data/fixtures/program-2026.json';
export const ARCHIVE_DB = 'data/archive.db';
export const ARCHIVE_MANIFEST = 'data/archive-manifest.json';
export const OTLP_SUFFIX = '/v1/traces';
