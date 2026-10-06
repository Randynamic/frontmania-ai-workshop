import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { backendConfigFrom, backendRequest, type BackendConfig } from '../backend/client.js';
import { REPO_ROOT } from '../data/paths.js';
import {
  RUN_KINDS,
  setCurrentRun,
  type CurrentRun,
  type RunKind,
} from '../feedback/current-run.js';
import { toMlflowTraceId } from '../trace-id.js';

/**
 * Links a run to the pseudonym at the backend (POST /api/runs) and keeps the
 * numbers a participant writes into the workbook in a git-ignored side file
 * `.talk-picker/last-<kind>.json`, which the check scripts read.
 */
export const RUN_DIR = resolve(REPO_ROOT, '.talk-picker');
const JSON_INDENT = 2;

export const LastRun = z
  .object({
    traceId: z.string().min(1),
    kind: z.enum(RUN_KINDS),
    tokens: z.number().int().nonnegative().nullable(),
    latencyMs: z.number().nonnegative().nullable(),
    recordedAt: z.string().datetime(),
  })
  .loose();
export type LastRun = z.infer<typeof LastRun>;

export const lastRunPath = (kind: RunKind, dir: string = RUN_DIR): string =>
  resolve(dir, `last-${kind}.json`);

export interface RegisterRunOptions {
  readonly config?: BackendConfig;
}

/** Registers the MLflow trace id (`tr-` + OTel id) for this pseudonym and makes it the current run. */
export const registerRun = async (
  otelTraceId: string,
  kind: RunKind,
  options: RegisterRunOptions = {},
): Promise<CurrentRun> => {
  const traceId = toMlflowTraceId(otelTraceId);
  const config = options.config ?? backendConfigFrom(process.env);
  await backendRequest(config, '/api/runs', {
    method: 'POST',
    body: { traceId, kind },
    schema: z.object({ ok: z.literal(true) }),
  });
  return setCurrentRun({ traceId, kind });
};

/** Writes `.talk-picker/last-<kind>.json`; extra fields (profile, plan, answer) ride along. */
export const writeLastRun = (
  kind: RunKind,
  record: Omit<LastRun, 'kind' | 'recordedAt'> & { readonly recordedAt?: string },
  dir: string = RUN_DIR,
): LastRun => {
  const full = LastRun.parse({
    ...record,
    kind,
    recordedAt: record.recordedAt ?? new Date().toISOString(),
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(lastRunPath(kind, dir), `${JSON.stringify(full, null, JSON_INDENT)}\n`, 'utf8');
  return full;
};

/** Undefined when the file is missing; throws when it exists but is not a LastRun. */
export const readLastRun = (kind: RunKind, dir: string = RUN_DIR): LastRun | undefined => {
  const path = lastRunPath(kind, dir);
  const text = (() => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  })();
  if (text === undefined) return undefined;
  const parsed = LastRun.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`${path} is not a run record at ${first?.path.join('.')}: ${first?.message}`);
  }
  return parsed.data;
};
