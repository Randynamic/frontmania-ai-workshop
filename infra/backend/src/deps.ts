import type { BackendEnv } from './env.js';
import type { LitellmClient } from './litellm.js';
import type { MlflowClient } from './mlflow.js';
import type { LoadedProgram } from './program.js';
import type { Store } from './store.js';

/** Everything the routes and the worker need, injected so tests run with fakes. */
export interface AppDeps {
  readonly env: BackendEnv;
  readonly store: Store;
  readonly mlflow: MlflowClient;
  readonly litellm: LitellmClient;
  readonly program: LoadedProgram | undefined;
  readonly issuePseudonym: () => string;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export const PARTICIPANT_ID_PATTERN = /^[a-z]+-[0-9]+$/;
export const PROMPT_NAMES = ['profile', 'ranker', 'tip'] as const;
export { RUN_KINDS } from '../../../src/schemas/run.js';
