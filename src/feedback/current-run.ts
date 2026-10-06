/**
 * The run the CLIs last registered, so submitFeedback can attach a verdict
 * to the right trace without the participant copying ids. Process-local by
 * design: one script run is one participant run.
 */
import { RUN_KINDS, type RunKind } from '../schemas/run.js';

export { RUN_KINDS, type RunKind };

export interface CurrentRun {
  readonly traceId: string;
  readonly kind: RunKind;
}

let currentRun: CurrentRun | undefined;

export const setCurrentRun = (run: CurrentRun): CurrentRun => {
  if (!run.traceId) throw new Error('setCurrentRun: traceId is empty');
  currentRun = { traceId: run.traceId, kind: run.kind };
  return currentRun;
};

export const getCurrentRun = (): CurrentRun | undefined => currentRun;

export const clearCurrentRun = (): void => {
  currentRun = undefined;
};
