import { z } from 'zod';
import { backendConfigFrom, backendRequest, type BackendConfig } from '../backend/client.js';
import { FeedbackInput } from '../schemas/feedback.js';
import { getCurrentRun, type CurrentRun } from './current-run.js';
import { sinkFeedback } from './sink.js';

/** What POST /api/feedback answers; the id is the backend row, attached to MLflow by its worker. */
export const FeedbackReceipt = z.object({ ok: z.literal(true), id: z.string() });
export type FeedbackReceipt = z.infer<typeof FeedbackReceipt>;

export interface PostFeedbackOptions {
  readonly config?: BackendConfig;
  /** Defaults to the run the CLI registered last. */
  readonly run?: CurrentRun;
  /** Defaults to process.env; only MODEL_MODE is read when no `config` is given. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Sends one verdict on one slot for the current run. Validates before it
 * talks to the network. With an explicit `config` it always posts to that
 * backend; without one, MODEL_MODE=mock keeps the row in the in-process
 * sink (src/feedback/sink.ts) and live mode posts to WORKSHOP_BACKEND_URL.
 */
export const postFeedback = async (
  input: FeedbackInput,
  options: PostFeedbackOptions = {},
): Promise<FeedbackReceipt> => {
  const parsed = FeedbackInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`feedback invalid at ${first?.path.join('.') ?? '<root>'}: ${first?.message}`);
  }
  const run = options.run ?? getCurrentRun();
  if (!run) throw new Error('no current run: run pnpm plan or pnpm ask before giving feedback');
  const env = options.env ?? process.env;
  if (!options.config && env.MODEL_MODE === 'mock') {
    const { id } = sinkFeedback({ ...parsed.data, traceId: run.traceId });
    return { ok: true, id };
  }
  const config = options.config ?? backendConfigFrom(env);
  return backendRequest(config, '/api/feedback', {
    method: 'POST',
    body: { ...parsed.data, traceId: run.traceId },
    schema: FeedbackReceipt,
  });
};
