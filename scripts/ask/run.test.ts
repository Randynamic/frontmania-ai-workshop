import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '@mastra/core/agent';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearCurrentRun, getCurrentRun } from '../../src/feedback/current-run.js';
import { clearSunkFeedback, sunkFeedback } from '../../src/feedback/sink.js';
import { createMastra } from '../../src/mastra/index.js';
import { TokenTallyExporter } from '../../src/observability/token-tally.js';
import { readLastRun } from '../../src/run/record.js';
import { createSolvedPlanner, createStartPlanner } from '../../src/test-support/solved-planner.js';
import {
  DEFAULT_QUESTION,
  formatAskSummary,
  formatFeedbackSummary,
  formatToolOrder,
  runAsk,
  submittedFeedback,
  toolCallOrder,
} from './run.js';

/**
 * Branch-independent: the planner here is the test-support reference (or the
 * start-branch shape), never src/mastra/agents/planner.ts, so this file is
 * green on 03-start and 03-done. `pnpm check:03` judges the real planner.
 */
const FEEDBACK = ['--feedback', 'up:fits;down:too basic;up:a11y'];
const tempDir = () => mkdtempSync(join(tmpdir(), 'talk-picker-ask-'));
const mastraWith = (planner: Agent = createSolvedPlanner()) => {
  const tally = new TokenTallyExporter();
  return {
    mastra: createMastra({ MODEL_MODE: 'mock' }, { agents: { planner }, exporters: [tally] }),
    tally,
  };
};

afterEach(() => {
  clearCurrentRun();
  clearSunkFeedback();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('runAsk in mock mode', () => {
  test('two turns: tools, plan, three verdicts on the turn-1 trace, last-agent.json', async () => {
    // Arrange
    const runDir = tempDir();
    const { mastra, tally } = mastraWith();
    const answers: string[] = [];

    // Act
    const result = await runAsk(FEEDBACK, {
      env: { MODEL_MODE: 'mock' },
      mastra,
      tally,
      runDir,
      onAnswer: (answer) => answers.push(answer),
    });

    // Assert
    expect(result.question).toBe(DEFAULT_QUESTION);
    expect(result.toolCalls[0]).toBe('getTimetable');
    expect(result.toolCalls).toContain('searchArchive');
    expect(result.feedbackCalls).toEqual([
      { slot: '14:15', thumb: 'up', ok: true },
      { slot: '15:30', thumb: 'down', ok: true },
      { slot: '16:30', thumb: 'up', ok: true },
    ]);
    expect(new Set(sunkFeedback().map((r) => r.traceId))).toEqual(new Set([result.traceId]));
    expect(getCurrentRun()).toEqual({ traceId: result.traceId, kind: 'agent' });
    expect(answers).toEqual([result.answer]);
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.tokensTurn2).toBeGreaterThan(0);
    expect(result.modelCalls).toBeGreaterThanOrEqual(3);
    const last = readLastRun('agent', runDir);
    expect(last).toMatchObject({ tokensTurn2: result.tokensTurn2, modelCalls: result.modelCalls });
    expect(last).toMatchObject({ traceId: result.traceId, toolCalls: result.toolCalls });
    expect(last?.['feedbackCalls']).toHaveLength(3);
    expect(JSON.stringify(last)).not.toContain('because');
  });

  test('the question comes from the positional words; interactive verdicts are used without --feedback', async () => {
    const { mastra } = mastraWith();
    const result = await runAsk(['plan', 'it,', 'no', 'Vue'], {
      env: { MODEL_MODE: 'mock' },
      mastra,
      runDir: tempDir(),
      askVerdicts: async () => [
        { slot: '14:15', thumb: 'up', reason: 'a' },
        { slot: '15:30', thumb: 'up', reason: 'b' },
        { slot: '16:30', thumb: 'down', reason: 'c' },
      ],
    });
    expect(result.question).toBe('plan it, no Vue');
    expect(sunkFeedback().map((r) => r.thumb)).toEqual(['up', 'up', 'down']);
  });

  test('without --feedback and without a terminal it names the flag before any model call', async () => {
    // Arrange: live env, so a late failure would also have called the backend
    const planner = createSolvedPlanner();
    const generate = vi.spyOn(planner, 'generate');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { mastra } = mastraWith(planner);

    // Act + Assert
    await expect(
      runAsk([], {
        env: { MODEL_MODE: 'live', WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'k' },
        mastra,
        runDir: tempDir(),
      }),
    ).rejects.toThrow('pass --feedback');
    expect(generate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(
      runAsk(['--feedback', 'up:only one'], {
        env: { MODEL_MODE: 'mock' },
        mastra,
        runDir: tempDir(),
      }),
    ).rejects.toThrow('expected 3 verdicts');
    expect(generate).not.toHaveBeenCalled();
    const again = mastraWith().mastra;
    await expect(
      runAsk(['--feedback'], { env: { MODEL_MODE: 'mock' }, mastra: again, runDir: tempDir() }),
    ).rejects.toThrow('--feedback needs a value');
  });

  test('the start-branch planner (no tools) records nothing', async () => {
    const { mastra } = mastraWith(createStartPlanner());
    const result = await runAsk(FEEDBACK, {
      env: { MODEL_MODE: 'mock' },
      mastra,
      runDir: tempDir(),
    });
    expect(result.toolCalls).toEqual([]);
    expect(result.feedbackCalls).toEqual([]);
    expect(sunkFeedback()).toHaveLength(0);
  });
});

describe('runAsk in live mode (fake backend)', () => {
  test('registers the run as kind agent and posts three verdicts on that trace', async () => {
    // Arrange: live env and a fake network; the model stays mocked (the
    // planner here carries its own mock model), only the backend path is live.
    const calls: { url: string; body: unknown }[] = [];
    vi.stubEnv('MODEL_MODE', 'live');
    vi.stubEnv('WORKSHOP_BACKEND_URL', 'https://ws.test');
    vi.stubEnv('PROXY_API_KEY', 'sk-card');
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/api/whoami'))
        return new Response('{"ok":true,"participantId":"otter-42"}', { status: 200 });
      if (url.endsWith('/api/feedback'))
        return new Response(`{"ok":true,"id":"${calls.length}"}`, { status: 200 });
      return new Response('{"ok":true}', { status: 200 });
    });
    const { mastra } = mastraWith();

    // Act
    const result = await runAsk(FEEDBACK, { env: process.env, mastra, runDir: tempDir() });

    // Assert
    expect(result.participantId).toBe('otter-42');
    const runs = calls.filter((c) => c.url.endsWith('/api/runs'));
    expect(runs).toEqual([
      { url: 'https://ws.test/api/runs', body: { traceId: result.traceId, kind: 'agent' } },
    ]);
    const feedback = calls.filter((c) => c.url.endsWith('/api/feedback'));
    expect(feedback.map((c) => c.body)).toEqual([
      { slot: '14:15', thumb: 'up', reason: 'fits', traceId: result.traceId },
      { slot: '15:30', thumb: 'down', reason: 'too basic', traceId: result.traceId },
      { slot: '16:30', thumb: 'up', reason: 'a11y', traceId: result.traceId },
    ]);
    expect(calls.findIndex((c) => c.url.endsWith('/api/runs'))).toBeLessThan(
      calls.findIndex((c) => c.url.endsWith('/api/feedback')),
    );
    expect(result.feedbackCalls.every((c) => c.ok)).toBe(true);
    expect(sunkFeedback()).toHaveLength(0);
  });
});

describe('formatting helpers', () => {
  test('tool order, feedback summary and the run summary', () => {
    const steps = [
      { toolCalls: [{ payload: { toolName: 'getTimetable' } }] },
      {
        toolCalls: [{ payload: { toolName: 'submitFeedback' } }, {}],
        toolResults: [
          {
            payload: {
              toolName: 'submitFeedback',
              args: { slot: '14:15', thumb: 'up' },
              result: { ok: true },
            },
          },
          { payload: { toolName: 'submitFeedback', args: {}, result: { ok: false } } },
          { payload: { toolName: 'getTimetable', result: {} } },
        ],
      },
      {},
    ];
    expect(toolCallOrder(steps)).toEqual(['getTimetable', 'submitFeedback', '?']);
    const submitted = submittedFeedback(steps);
    expect(submitted).toEqual([
      { slot: '14:15', thumb: 'up', ok: true },
      { slot: '?', thumb: '?', ok: false },
    ]);
    expect(formatToolOrder([])).toBe('tools: none called');
    expect(formatFeedbackSummary(submitted)).toBe(
      'feedback: 1 of 3 verdicts stored (14:15 up, ? ? (not stored))',
    );
    expect(formatFeedbackSummary([])).toBe('feedback: 0 of 3 verdicts stored');
    const summary = formatAskSummary({
      question: 'q',
      answer: 'a',
      confirmation: 'c',
      toolCalls: ['getTimetable'],
      feedbackCalls: [],
      participantId: 'otter-42',
      traceId: 'tr-1',
      tokens: null,
      tokensTurn2: 300,
      modelCalls: 7,
      latencyMs: 12,
    });
    expect(summary).toContain('tools: getTimetable');
    expect(summary).toContain(
      'tokens: n/a + 300 (turn 1 + turn 2)  model calls: 7  latency: 12 ms (turn 1)',
    );
    expect(summary).toContain('trace: tr-1  participant: otter-42');
  });
});
