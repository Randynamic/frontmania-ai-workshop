import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { backendRequest } from '../../../src/backend/client.js';
import { loadPersonas } from '../../../src/data/personas.js';
import { REPO_ROOT } from '../../../src/data/paths.js';
import { readLastRun } from '../../../src/run/record.js';
import {
  backendConfigOrLine,
  fail,
  isMockRun,
  isStaticMode,
  lastRunOrFail,
  printReport,
  type CheckLine,
} from '../lib.js';
import { TRACE_CLIENT_TIMEOUT_MS, TraceResponse } from '../trace.js';
import { liveChecks02 } from './live.js';
import { staticChecks02 } from './static.js';

const SOURCE_FILES = {
  rankSlot: resolve(REPO_ROOT, 'src/mastra/workflows/steps/rank-slot.ts'),
  plan: resolve(REPO_ROOT, 'src/mastra/workflows/plan.ts'),
  tip: resolve(REPO_ROOT, 'src/mastra/workflows/steps/tip.ts'),
} as const;
const SAMPLE_PERSONA = '02-senior-react-architect';

const runLive = async (
  env: Readonly<Record<string, string | undefined>>,
): Promise<readonly CheckLine[]> => {
  const last = lastRunOrFail('plan', 'pnpm plan');
  if ('line' in last) return [last.line];
  if (isMockRun(last.run)) {
    return [
      fail(
        'last plan run',
        'last run was a mock run; run pnpm plan without MODEL_MODE=mock, then check again',
      ),
    ];
  }
  const backend = backendConfigOrLine(env, TRACE_CLIENT_TIMEOUT_MS);
  if ('line' in backend) return [backend.line];
  const { config } = backend;
  const lastCompare = (() => {
    try {
      return readLastRun('compare');
    } catch {
      return undefined;
    }
  })();
  return liveChecks02({
    lastPlan: last.run,
    lastCompare,
    fetchTrace: (traceId) =>
      backendRequest(config, `/api/traces/${traceId}`, { schema: TraceResponse }),
    progress: (line) => console.log(line),
  });
};

export const main = async (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> => {
  const startedAt = Date.now();
  const staticOnly = isStaticMode(argv, env);
  const { mastra } = await import('../../../src/mastra/index.js');
  const persona = loadPersonas().find((p) => p.name === SAMPLE_PERSONA);
  if (!persona) throw new Error(`persona ${SAMPLE_PERSONA} missing from data/cvs`);
  const staticLines = await staticChecks02({
    mastra,
    sources: {
      rankSlot: readFileSync(SOURCE_FILES.rankSlot, 'utf8'),
      plan: readFileSync(SOURCE_FILES.plan, 'utf8'),
      tip: readFileSync(SOURCE_FILES.tip, 'utf8'),
    },
    profile: persona.profile,
  });
  const liveLines = staticOnly ? [] : await runLive(env);
  return printReport('02', [...staticLines, ...liveLines], { staticOnly, startedAt });
};
