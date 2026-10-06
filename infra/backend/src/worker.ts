import type { MlflowClient } from './mlflow.js';
import type { Store } from './store.js';

/**
 * Background attachment of feedback (thumb + reason) and expectations (blind
 * picks) to MLflow traces as assessments. Rows are stored first and attached
 * with retry, because feedback arrives before the exporter has flushed the
 * trace. Each pass is one call; the server runs it on an interval.
 */
export const FEEDBACK_ASSESSMENT = 'slot_pick';
export const EXPECTATION_ASSESSMENT = 'expected_pick';

export interface WorkerDeps {
  readonly store: Store;
  readonly mlflow: MlflowClient;
  readonly maxAttempts: number;
  readonly log: (message: string) => void;
}

export interface WorkerPass {
  readonly feedbackAttached: number;
  readonly expectationsAttached: number;
}

const attachFeedback = async (deps: WorkerDeps): Promise<number> => {
  const pending = await deps.store.pendingFeedback(deps.maxAttempts);
  const outcomes = await Promise.all(
    pending.map(async (row) => {
      try {
        await deps.mlflow.createAssessment({
          traceId: row.traceId,
          name: FEEDBACK_ASSESSMENT,
          sourceId: row.participantId,
          feedback: row.thumb,
          rationale: row.reason,
          metadata: { slot: row.slot },
        });
        await deps.store.markFeedbackAttached(row.id);
        return 1;
      } catch (error) {
        await deps.store.markFeedbackAttempt(row.id);
        deps.log(
          `feedback ${row.id} not attached yet: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 0;
      }
    }),
  );
  return outcomes.reduce<number>((a, b) => a + b, 0);
};

const attachExpectations = async (deps: WorkerDeps): Promise<number> => {
  const runs = await deps.store.runsAwaitingExpectations();
  const outcomes = await Promise.all(
    runs.map(async (run) => {
      const picks = (await deps.store.getPicks(run.participantId)) ?? {};
      try {
        await Promise.all(
          Object.entries(picks).map(([slot, talkId]) =>
            deps.mlflow.createAssessment({
              traceId: run.traceId,
              name: EXPECTATION_ASSESSMENT,
              sourceId: run.participantId,
              expectation: talkId,
              metadata: { slot },
            }),
          ),
        );
        await deps.store.markExpectationsAttached(run.traceId);
        return 1;
      } catch (error) {
        deps.log(
          `expectations for ${run.traceId} not attached yet: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 0;
      }
    }),
  );
  return outcomes.reduce<number>((a, b) => a + b, 0);
};

export const runWorkerPass = async (deps: WorkerDeps): Promise<WorkerPass> => ({
  feedbackAttached: await attachFeedback(deps),
  expectationsAttached: await attachExpectations(deps),
});

/** Starts the interval; returns a stop function. Passes never overlap. */
export const startWorker = (deps: WorkerDeps, intervalMs: number): (() => void) => {
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await runWorkerPass(deps);
    } catch (error) {
      deps.log(`worker pass failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      busy = false;
    }
  };
  const handle = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(handle);
};
