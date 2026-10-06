import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Mastra } from '@mastra/core';
import { backendRequest } from '../../../src/backend/client.js';
import { REPO_ROOT } from '../../../src/data/paths.js';
import { clearSunkFeedback, sunkFeedback } from '../../../src/feedback/sink.js';
import { runAsk } from '../../ask/run.js';
import {
  backendConfigOrLine,
  blocked,
  isMockRun,
  isStaticMode,
  lastRunOrFail,
  printReport,
  type CheckLine,
} from '../lib.js';
import { TRACE_CLIENT_TIMEOUT_MS, TraceResponse } from '../trace.js';
import { FeedbackRows, liveChecks03 } from './live.js';
import { staticChecks03, type ToolLike } from './static.js';

const SOURCE_FILES = {
  submitFeedback: resolve(REPO_ROOT, 'src/mastra/tools/submit-feedback.ts'),
  planner: resolve(REPO_ROOT, 'src/mastra/agents/planner.ts'),
} as const;
export const SAMPLE_FEEDBACK = 'up:fits my stack;down:too basic for me;up:accessibility matters';

/** `pnpm ask` once, offline, into a throwaway run directory; the rows come from the in-memory sink. */
export const mockTwoTurns = (mastra: Mastra) => async (): Promise<readonly { slot: string }[]> => {
  const runDir = mkdtempSync(join(tmpdir(), 'talk-picker-check03-'));
  clearSunkFeedback();
  try {
    await runAsk(['--feedback', SAMPLE_FEEDBACK], { env: { MODEL_MODE: 'mock' }, mastra, runDir });
    return sunkFeedback();
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

const runLive = async (
  env: Readonly<Record<string, string | undefined>>,
): Promise<readonly CheckLine[]> => {
  const last = lastRunOrFail('agent', 'pnpm ask');
  if ('line' in last) return [last.line];
  // A mock run has no trace and no rows at the backend: one line, no query.
  if (isMockRun(last.run)) {
    return [blocked('last agent run', 'last run was mock; run pnpm check:03 --static')];
  }
  const backend = backendConfigOrLine(env, TRACE_CLIENT_TIMEOUT_MS);
  if ('line' in backend) return [backend.line];
  const { config } = backend;
  return liveChecks03({
    lastAgent: last.run,
    fetchFeedback: async (traceId) =>
      (
        await backendRequest(config, `/api/feedback?traceId=${encodeURIComponent(traceId)}`, {
          schema: FeedbackRows,
        })
      ).rows,
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
  const { AGENTS, createMastra } = await import('../../../src/mastra/index.js');
  const { submitFeedback } = await import('../../../src/mastra/tools/submit-feedback.js');
  const mastra = createMastra({ MODEL_MODE: 'mock' }, { agents: AGENTS });
  const staticLines = await staticChecks03({
    sources: {
      submitFeedback: readFileSync(SOURCE_FILES.submitFeedback, 'utf8'),
      planner: readFileSync(SOURCE_FILES.planner, 'utf8'),
    },
    submitFeedback: submitFeedback as ToolLike,
    planner: mastra.getAgent('planner'),
    runTwoTurns: mockTwoTurns(mastra),
  });
  const liveLines = staticOnly ? [] : await runLive(env);
  return printReport('03', [...staticLines, ...liveLines], { staticOnly, startedAt });
};
