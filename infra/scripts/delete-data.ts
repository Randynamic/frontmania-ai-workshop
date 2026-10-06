import { MlflowClient } from '../backend/src/mlflow.js';
import { adminFetch, fetchStats, readAdminEnv, type AdminStats } from './lib/admin-client.js';
import { parseArgs } from './lib/args.js';
import { deletionMode } from './lib/deletion-mode.js';

/**
 * pnpm data:delete            -> dry run: prints counts, deletes nothing (same as --dry-run)
 * pnpm data:delete --dry-run  -> the explicit form; wins over --execute when both are given
 * pnpm data:delete --execute  -> deletes every trace in experiment frontmania-2026 (MLflow REST,
 *                                basic auth on the UI host) and every backend row, counts again,
 *                                exits 0 only when everything is 0
 * 18:00 on the day. The runbook records the printed after-counts as proof.
 */
const SEARCH_CAP = 500;

interface MlflowEnv {
  readonly url: string;
  readonly user: string;
  readonly password: string;
  readonly experimentId: string;
}

const readMlflowEnv = (env: Record<string, string | undefined>): MlflowEnv => {
  const url = env['MLFLOW_UI_URL'];
  const user = env['MLFLOW_UI_USER'];
  const password = env['MLFLOW_UI_PASSWORD'];
  const experimentId = env['MLFLOW_EXPERIMENT_ID'];
  if (!url || !user || !password || !experimentId) {
    throw new Error(
      'MLFLOW_UI_URL, MLFLOW_UI_USER, MLFLOW_UI_PASSWORD and MLFLOW_EXPERIMENT_ID must be set (infra/.env)',
    );
  }
  return { url, user, password, experimentId };
};

const basicAuthClient = (env: MlflowEnv): MlflowClient => {
  const credentials = Buffer.from(`${env.user}:${env.password}`).toString('base64');
  return new MlflowClient({
    baseUrl: env.url,
    experimentId: env.experimentId,
    fetchImpl: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          authorization: `Basic ${credentials}`,
        },
      }),
  });
};

const countTraces = async (mlflow: MlflowClient): Promise<number> =>
  (await mlflow.searchTraceIds(SEARCH_CAP)).length;

const formatCounts = (label: string, traces: number, stats: AdminStats): string =>
  `${label}: traces=${traces}${traces >= SEARCH_CAP ? '+' : ''} profiles=${stats.profiles} picks=${stats.picks} runs=${stats.runs} feedback=${stats.feedback} keys=${stats.keys}`;

const isEmpty = (traces: number, stats: AdminStats): boolean =>
  traces === 0 &&
  stats.profiles === 0 &&
  stats.picks === 0 &&
  stats.runs === 0 &&
  stats.feedback === 0 &&
  stats.keys === 0;

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const isExecute = deletionMode(args) === 'execute';
  const admin = readAdminEnv(process.env);
  const mlflow = basicAuthClient(readMlflowEnv(process.env));
  const [tracesBefore, statsBefore] = await Promise.all([countTraces(mlflow), fetchStats(admin)]);
  console.log(formatCounts('before', tracesBefore, statsBefore));
  if (!isExecute) {
    console.log(
      'dry run (default, or --dry-run). Re-run with --execute to delete. Nothing was deleted.',
    );
    return;
  }
  const tracesDeleted = await mlflow.deleteAllTraces();
  const wiped = await adminFetch<{ deleted: number }>(admin, '/api/admin/wipe', { method: 'POST' });
  console.log(`deleted: traces=${tracesDeleted} rows=${wiped.deleted}`);
  const [tracesAfter, statsAfter] = await Promise.all([countTraces(mlflow), fetchStats(admin)]);
  console.log(formatCounts('after', tracesAfter, statsAfter));
  const clean = isEmpty(tracesAfter, statsAfter);
  console.log(
    clean
      ? `deletion confirmed at ${new Date().toISOString()}`
      : 'NOT EMPTY: investigate before teardown',
  );
  process.exit(clean ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
