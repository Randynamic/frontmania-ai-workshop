import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { backendRequest } from '../../../src/backend/client.js';
import { DATA_PATHS, REPO_ROOT } from '../../../src/data/paths.js';
import {
  backendConfigOrLine,
  fail,
  isMockRun,
  isStaticMode,
  lastRunOrFail,
  printReport,
  skip,
  type CheckLine,
} from '../lib.js';
import { AGENT_FILE, loadExerciseModules01, SCHEMA_FILE, staticChecks01 } from './static.js';

const SAMPLE_CV = resolve(DATA_PATHS.cvsDir, '02-senior-react-architect.md');
const PROFILE_COMMAND = 'pnpm run profile --cv data/cvs/02-senior-react-architect.md';

const readOptional = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** What `--static` leaves out, so nobody reads a green static run as "masked: yes". */
const SKIPPED_LIVE_LINES: readonly CheckLine[] = [
  skip('masked', 'live layer; run `pnpm check:01` without --static after `pnpm run profile`'),
  skip('numbers for the workbook', 'live layer; tokens and latency come from your traced run'),
];

const runLive = async (
  env: Readonly<Record<string, string | undefined>>,
): Promise<readonly CheckLine[]> => {
  const last = lastRunOrFail('profile', PROFILE_COMMAND);
  if ('line' in last) return [last.line];
  if (isMockRun(last.run)) {
    return [
      fail(
        'last profile run',
        'last run was a mock run; run pnpm run profile without MODEL_MODE=mock, then check again',
      ),
    ];
  }
  // Imported only after the exercise files loaded: live.ts reads the Profile schema.
  const { liveChecks01, TraceResponse, TRACE_CLIENT_TIMEOUT_MS } = await import('./live.js');
  const backend = backendConfigOrLine(env, TRACE_CLIENT_TIMEOUT_MS);
  if ('line' in backend) return [backend.line];
  return liveChecks01({
    lastRun: last.run,
    fetchTrace: (traceId) =>
      backendRequest(backend.config, `/api/traces/${traceId}`, { schema: TraceResponse }),
    readInput: readOptional,
    progress: (line) => console.log(line),
  });
};

export const main = async (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> => {
  const startedAt = Date.now();
  const staticOnly = isStaticMode(argv, env);
  const loaded = await loadExerciseModules01();
  if ('lines' in loaded) return printReport('01', loaded.lines, { staticOnly, startedAt });
  const staticLines = await staticChecks01({
    ...loaded.modules,
    sources: {
      schema: readFileSync(resolve(REPO_ROOT, SCHEMA_FILE), 'utf8'),
      agent: readFileSync(resolve(REPO_ROOT, AGENT_FILE), 'utf8'),
    },
    sampleCv: readFileSync(SAMPLE_CV, 'utf8'),
  });
  const liveLines = staticOnly ? SKIPPED_LIVE_LINES : await runLive(env);
  return printReport('01', [...staticLines, ...liveLines], { staticOnly, startedAt });
};
