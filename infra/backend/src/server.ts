import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { generatePseudonyms } from '../../scripts/lib/pseudonym.js';
import { createApp } from './app.js';
import { readBackendEnv } from './env.js';
import { LitellmClient } from './litellm.js';
import { MlflowClient } from './mlflow.js';
import { loadProgram } from './program.js';
import { Store } from './store.js';
import { startWorker } from './worker.js';

const ISSUED_ID_BATCH = 200;

const main = async (): Promise<void> => {
  const env = readBackendEnv(process.env);
  mkdirSync(resolve(env.DATA_DIR), { recursive: true });
  const store = await Store.open(`file:${resolve(env.DATA_DIR, 'backend.db')}`);
  const mlflow = new MlflowClient({
    baseUrl: env.MLFLOW_URL,
    experimentId: env.MLFLOW_EXPERIMENT_ID,
  });
  const litellm = new LitellmClient({
    baseUrl: env.LITELLM_URL,
    masterKey: env.LITELLM_MASTER_KEY,
  });
  const program = loadProgram(resolve(env.PROGRAM_FILE), resolve(env.PROGRAM_FIXTURE));
  const idPool = generatePseudonyms(ISSUED_ID_BATCH);
  let issued = 0;
  const issuePseudonym = (): string =>
    `${idPool[issued++ % idPool.length]}${issued > idPool.length ? `-${issued}` : ''}`;

  const app = createApp({
    env,
    store,
    mlflow,
    litellm,
    program,
    issuePseudonym,
    now: () => Date.now(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  });

  const stopWorker = startWorker(
    {
      store,
      mlflow,
      maxAttempts: env.ATTACH_MAX_ATTEMPTS,
      log: (m) => console.warn(`[worker] ${m}`),
    },
    env.WORKER_INTERVAL_MS,
  );
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(
      `[backend] listening on :${info.port}, id variant ${env.ID_VARIANT}, programme ${program ? program.path : 'absent'}`,
    );
  });

  const shutdown = (): void => {
    stopWorker();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

main().catch((error: unknown) => {
  console.error('[backend] failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
