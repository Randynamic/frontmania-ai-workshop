import { backendConfigFrom, type BackendConfig } from '../../src/backend/client.js';
import { readLastRun, type LastRun } from '../../src/run/record.js';
import type { RunKind } from '../../src/schemas/run.js';

/**
 * Shared reporter for pnpm check:01, check:02, check:03.
 *
 * One line per assertion: OK, FAIL (names the missing piece and the step)
 * or BLOCKED (the live layer could not run; the remedy is the detail).
 * SKIP names a live assertion that `--static` did not run; it never changes
 * the exit code. Exit codes: 0 all OK, 1 any FAIL, 2 no FAIL but at least
 * one BLOCKED.
 * `--static` or CHECK_MODE=static runs the static layer only.
 */
export type CheckStatus = 'OK' | 'WARN' | 'FAIL' | 'BLOCKED' | 'SKIP';

export interface CheckLine {
  readonly status: CheckStatus;
  readonly name: string;
  readonly detail: string;
}

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_BLOCKED = 2;

export const ok = (name: string, detail = ''): CheckLine => ({ status: 'OK', name, detail });
export const fail = (name: string, detail: string): CheckLine => ({ status: 'FAIL', name, detail });
export const blocked = (name: string, remedy: string): CheckLine => ({
  status: 'BLOCKED',
  name,
  detail: remedy,
});
/** Worth a look, never a failure: the exit code ignores WARN lines. */
export const warn = (name: string, detail: string): CheckLine => ({ status: 'WARN', name, detail });

/** A live-layer assertion that `--static` did not run. */
export const skip = (name: string, detail: string): CheckLine => ({ status: 'SKIP', name, detail });

/** OK when the condition holds, else FAIL with the given message. */
export const assertion = (
  name: string,
  holds: boolean,
  failDetail: string,
  okDetail = '',
): CheckLine => (holds ? ok(name, okDetail) : fail(name, failDetail));

export const isStaticMode = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): boolean => argv.includes('--static') || env.CHECK_MODE === 'static';

export const exitCodeFor = (lines: readonly CheckLine[]): number => {
  if (lines.some((line) => line.status === 'FAIL')) return EXIT_FAIL;
  if (lines.some((line) => line.status === 'BLOCKED')) return EXIT_BLOCKED;
  return EXIT_OK;
};

const STATUS_WIDTH = 7;

export const formatLine = (line: CheckLine): string =>
  `${line.status.padEnd(STATUS_WIDTH)} ${line.name}${line.detail ? `: ${line.detail}` : ''}`;

export const formatSummary = (
  exercise: string,
  lines: readonly CheckLine[],
  options: { readonly staticOnly: boolean; readonly elapsedMs: number },
): string => {
  const count = (status: CheckStatus): number => lines.filter((l) => l.status === status).length;
  const verdict =
    exitCodeFor(lines) === EXIT_OK
      ? `check:${exercise} passed`
      : exitCodeFor(lines) === EXIT_FAIL
        ? `check:${exercise} failed`
        : `check:${exercise} blocked (static layer passed, live layer could not run)`;
  const layer = options.staticOnly ? 'static layer only' : 'static + live';
  const skipped = count('SKIP') > 0 ? `, ${count('SKIP')} SKIP` : '';
  return `${verdict}: ${count('OK')} OK, ${count('FAIL')} FAIL, ${count('BLOCKED')} BLOCKED${skipped} (${layer}, ${options.elapsedMs} ms)`;
};

/** The recorded run for a CLI, or a FAIL line telling the participant which script to run. */
export const lastRunOrFail = (
  kind: RunKind,
  script: string,
  dir?: string,
): { readonly run: LastRun } | { readonly line: CheckLine } => {
  try {
    const run = readLastRun(kind, dir);
    return run ? { run } : { line: fail(`last ${kind} run`, `not found; run \`${script}\` first`) };
  } catch (error) {
    return {
      line: fail(`last ${kind} run`, error instanceof Error ? error.message : String(error)),
    };
  }
};

/** Every string inside a JSON-like value, for "does this text appear anywhere" checks. */
export const collectStrings = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
};

export const printReport = (
  exercise: string,
  lines: readonly CheckLine[],
  options: { readonly staticOnly: boolean; readonly startedAt: number },
  log: (line: string) => void = console.log,
): number => {
  for (const line of lines) log(formatLine(line));
  log(formatSummary(exercise, lines, { ...options, elapsedMs: Date.now() - options.startedAt }));
  return exitCodeFor(lines);
};

/** The id `pnpm run profile`, `pnpm plan` and `pnpm ask` record when MODEL_MODE=mock skipped the backend. */
export const MOCK_RUN_ID = 'mock';

/** True when the recorded run came from MODEL_MODE=mock: no trace at the backend to look for. */
export const isMockRun = (run: LastRun): boolean =>
  run['mode'] === 'mock' || run['participantId'] === MOCK_RUN_ID;

/**
 * The backend config for the live layer, or a FAIL line when `.env` lacks a
 * value. A missing key is a local problem with a local fix, not an
 * unreachable backend.
 */
export const backendConfigOrLine = (
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs: number,
): { readonly config: BackendConfig } | { readonly line: CheckLine } => {
  const missing = ['WORKSHOP_BACKEND_URL', 'PROXY_API_KEY'].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    const card = missing.includes('PROXY_API_KEY') ? ' and paste the key from your card' : '';
    return {
      line: fail(
        'local config',
        `${missing.join(' and ')} missing or empty in .env; compare .env with .env.example${card}`,
      ),
    };
  }
  return { config: backendConfigFrom(env, { timeoutMs }) };
};
