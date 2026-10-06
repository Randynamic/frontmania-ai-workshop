import { z } from 'zod';

const DEFAULT_PORT = 3000;
const DEFAULT_TRACE_WAIT_MS = 20_000;
const DEFAULT_WORKER_INTERVAL_MS = 5_000;
const DEFAULT_ATTACH_MAX_ATTEMPTS = 24;
const MIN_ADMIN_TOKEN_LENGTH = 16;

/**
 * ID_VARIANT selects how a participant gets a pseudonym (repo-plan 4.1):
 * - slip: the id is printed on the key slip; /api/whoami derives it from the key.
 * - page: the blind-pick page issues the id; pnpm run doctor links key and id via /api/register.
 */
export const IdVariant = z.enum(['slip', 'page']);
export type IdVariant = z.infer<typeof IdVariant>;

export const BackendEnv = z.object({
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  DATA_DIR: z.string().min(1).default('./infra/backend/data'),
  PROGRAM_FILE: z.string().min(1).default('./data/program-2026.json'),
  PROGRAM_FIXTURE: z.string().min(1).default('./data/fixtures/program-2026.json'),
  MLFLOW_URL: z.string().url().default('http://localhost:5000'),
  MLFLOW_EXPERIMENT_ID: z.string().default(''),
  LITELLM_URL: z.string().url().default('http://localhost:4000'),
  LITELLM_MASTER_KEY: z.string().default(''),
  WORKSHOP_ADMIN_TOKEN: z
    .string()
    .min(
      MIN_ADMIN_TOKEN_LENGTH,
      `WORKSHOP_ADMIN_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters`,
    ),
  ID_VARIANT: IdVariant.default('slip'),
  /**
   * Reveal fallback (blueprint G11): when set, GET /api/prompts/ranker serves
   * this registered version instead of resolving alias `production`, so
   * "restart with the version pinned" is one variable plus
   * `docker compose up -d backend`, not a code change. Empty by default.
   */
  RANKER_PROMPT_VERSION: z.string().trim().default(''),
  TRACE_WAIT_MS: z.coerce.number().int().positive().default(DEFAULT_TRACE_WAIT_MS),
  WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(DEFAULT_WORKER_INTERVAL_MS),
  ATTACH_MAX_ATTEMPTS: z.coerce.number().int().positive().default(DEFAULT_ATTACH_MAX_ATTEMPTS),
});

export type BackendEnv = z.infer<typeof BackendEnv>;

/** Fails fast with the list of invalid variables. */
export const readBackendEnv = (source: Record<string, string | undefined>): BackendEnv => {
  const parsed = BackendEnv.safeParse(source);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`backend env invalid:\n  ${problems.join('\n  ')}`);
};
