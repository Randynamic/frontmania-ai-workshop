import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MlflowClient } from './mlflow.js';
import { Store } from './store.js';
import { fakeMlflowFetch, type FakeMlflowState } from './test-helpers.js';
import {
  EXPECTATION_ASSESSMENT,
  FEEDBACK_ASSESSMENT,
  runWorkerPass,
  startWorker,
  type WorkerDeps,
} from './worker.js';

let store: Store;
let state: FakeMlflowState;
let deps: WorkerDeps;
let logged: string[];

beforeEach(async () => {
  store = await Store.open(':memory:');
  state = { traces: {}, assessments: [], failAssessments: false, down: false };
  logged = [];
  deps = {
    store,
    mlflow: new MlflowClient({
      baseUrl: 'http://mlflow:5000',
      experimentId: '7',
      fetchImpl: fakeMlflowFetch(state),
    }),
    maxAttempts: 2,
    log: (m) => logged.push(m),
  };
});
afterEach(() => store.close());

describe('runWorkerPass', () => {
  test('attaches stored feedback as a HUMAN feedback assessment with slot metadata', async () => {
    await store.saveRun('tr-1', 'otter-42', 'agent');
    await store.saveFeedback({
      participantId: 'otter-42',
      traceId: 'tr-1',
      slot: '15:30',
      thumb: 'down',
      reason: 'too basic',
    });

    const pass = await runWorkerPass(deps);

    expect(pass).toEqual({ feedbackAttached: 1, expectationsAttached: 0 });
    expect(state.assessments[0]).toEqual({
      assessment: {
        trace_id: 'tr-1',
        assessment_name: FEEDBACK_ASSESSMENT,
        source: { source_type: 'HUMAN', source_id: 'otter-42' },
        feedback: { value: 'down' },
        rationale: 'too basic',
        metadata: { slot: '15:30' },
      },
    });
    expect((await store.listFeedbackByTrace('tr-1', 'otter-42'))[0]?.attachedAt).not.toBeNull();
  });

  test('retries until maxAttempts when the trace is not there yet', async () => {
    await store.saveFeedback({
      participantId: 'otter-42',
      traceId: 'tr-1',
      slot: '14:15',
      thumb: 'up',
      reason: 'r',
    });
    state.failAssessments = true;

    expect((await runWorkerPass(deps)).feedbackAttached).toBe(0);
    expect((await runWorkerPass(deps)).feedbackAttached).toBe(0);
    expect(await store.pendingFeedback(deps.maxAttempts)).toEqual([]);
    expect(logged.some((m) => m.includes('feedback 1 not attached yet'))).toBe(true);
    state.failAssessments = false;
    expect((await runWorkerPass(deps)).feedbackAttached).toBe(0);
  });

  test('attaches blind picks as expectations on plan runs, once', async () => {
    await store.savePicks('otter-42', { '14:15': 't1', '15:30': 't2', '16:30': 't3' });
    await store.saveRun('tr-plan', 'otter-42', 'plan');
    await store.saveRun('tr-profile', 'otter-42', 'profile');

    const first = await runWorkerPass(deps);
    const second = await runWorkerPass(deps);

    expect(first.expectationsAttached).toBe(1);
    expect(second.expectationsAttached).toBe(0);
    const names = state.assessments.map(
      (a) => (a as { assessment: { assessment_name: string; trace_id: string } }).assessment,
    );
    expect(names).toHaveLength(3);
    expect(
      names.every((a) => a.assessment_name === EXPECTATION_ASSESSMENT && a.trace_id === 'tr-plan'),
    ).toBe(true);
  });

  test('keeps plan runs pending when MLflow rejects the expectations', async () => {
    await store.savePicks('otter-42', { '14:15': 't1' });
    await store.saveRun('tr-plan', 'otter-42', 'plan');
    state.failAssessments = true;

    expect((await runWorkerPass(deps)).expectationsAttached).toBe(0);
    expect((await store.runsAwaitingExpectations()).map((r) => r.traceId)).toEqual(['tr-plan']);
  });
});

describe('startWorker', () => {
  test('runs passes on the interval and stops cleanly', async () => {
    vi.useFakeTimers();
    await store.saveRun('tr-1', 'otter-42', 'agent');
    await store.saveFeedback({
      participantId: 'otter-42',
      traceId: 'tr-1',
      slot: '14:15',
      thumb: 'up',
      reason: 'r',
    });

    const stop = startWorker(deps, 1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();

    expect(state.assessments).toHaveLength(1);
  });
});
