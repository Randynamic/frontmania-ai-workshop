import type { FeedbackInput } from '../schemas/feedback.js';

/**
 * Where feedback goes in MODEL_MODE=mock: an in-process list instead of the
 * workshop backend, so `pnpm ask` and `pnpm check:03 --static` run offline
 * and can count the rows the agent submitted. Process-local by design, like
 * the current run; the list is replaced, never mutated in place.
 */
export interface SunkFeedback extends FeedbackInput {
  readonly id: string;
  readonly traceId: string;
}

let rows: readonly SunkFeedback[] = [];

export const sinkFeedback = (row: FeedbackInput & { readonly traceId: string }): SunkFeedback => {
  const stored: SunkFeedback = { ...row, id: `mock-${rows.length + 1}` };
  rows = [...rows, stored];
  return stored;
};

export const sunkFeedback = (): readonly SunkFeedback[] => rows;

export const clearSunkFeedback = (): void => {
  rows = [];
};
