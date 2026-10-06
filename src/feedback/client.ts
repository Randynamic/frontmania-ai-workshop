import { z } from 'zod';
import { backendConfigFrom, backendRequest, type BackendConfig } from '../backend/client.js';
import { FeedbackInput } from '../schemas/feedback.js';
import { getCurrentRun, type CurrentRun } from './current-run.js';

/** What POST /api/feedback answers; the id is the backend row, attached to MLflow by its worker. */
export const FeedbackReceipt = z.object({ ok: z.literal(true), id: z.string() });
export type FeedbackReceipt = z.infer<typeof FeedbackReceipt>;

export interface PostFeedbackOptions {
  readonly config?: BackendConfig;
  /** Defaults to the run the CLI registered last. */
  readonly run?: CurrentRun;
}

/** Sends one verdict on one slot for the current run. Validates before it talks to the network. */
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
  const config = options.config ?? backendConfigFrom(process.env);
  return backendRequest(config, '/api/feedback', {
    method: 'POST',
    body: { ...parsed.data, traceId: run.traceId },
    schema: FeedbackReceipt,
  });
};
