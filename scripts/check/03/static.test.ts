import { createTool } from '@mastra/core/tools';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { clearCurrentRun } from '../../../src/feedback/current-run.js';
import { clearSunkFeedback } from '../../../src/feedback/sink.js';
import { createMastra } from '../../../src/mastra/index.js';
import {
  createSolvedPlanner,
  createStartPlanner,
  solvedSubmitFeedback,
} from '../../../src/test-support/solved-planner.js';
import { mockTwoTurns } from './main.js';
import { staticChecks03, type ToolLike } from './static.js';

/**
 * Branch-independent: the solved state is the test-support reference
 * planner and tool, the start state is rebuilt inline (empty description,
 * `z.object({})`, no tools, placeholder instructions), so this file is green
 * on 03-start and 03-done. The real files are judged by `pnpm check:03`.
 */
afterEach(() => {
  clearSunkFeedback();
  clearCurrentRun();
});

const cleanSources = { submitFeedback: 'solved', planner: 'solved' };
const startSources = {
  submitFeedback: '// TODO(exercise 03, step 1): define the tool',
  planner: '// TODO(exercise 03, step 2): tools and instructions',
};
const startSubmitFeedback = createTool({
  id: 'submitFeedback',
  description: '',
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: false }),
});

const solvedInputs = () => {
  const planner = createSolvedPlanner();
  const mastra = createMastra({ MODEL_MODE: 'mock' }, { agents: { planner } });
  return {
    sources: cleanSources,
    submitFeedback: solvedSubmitFeedback as ToolLike,
    planner: mastra.getAgent('planner'),
    runTwoTurns: mockTwoTurns(mastra),
  };
};

const failing = (lines: readonly { status: string; detail: string }[]) =>
  lines.filter((l) => l.status === 'FAIL').map((l) => l.detail);

describe('check:03 static layer', () => {
  test('passes on the solved planner and tool', async () => {
    // Act
    const lines = await staticChecks03(solvedInputs());

    // Assert
    expect(failing(lines)).toEqual([]);
    expect(lines.find((l) => l.name === 'mock two-turn ask')?.detail).toBe(
      '3 feedback rows, slots 14:15, 15:30, 16:30',
    );
  });

  test('fails on the start state with one message per step', async () => {
    // Arrange
    const planner = createStartPlanner();
    const mastra = createMastra({ MODEL_MODE: 'mock' }, { agents: { planner } });

    // Act
    const lines = await staticChecks03({
      sources: startSources,
      submitFeedback: startSubmitFeedback as ToolLike,
      planner: mastra.getAgent('planner'),
      runTwoTurns: mockTwoTurns(mastra),
    });

    // Assert
    expect(failing(lines)).toEqual([
      'a TODO(exercise 03, step 1) marker remains (step 1)',
      'a TODO(exercise 03, step 2) marker remains (step 2)',
      'submitFeedback has no input schema (step 1)',
      '0 characters, expected at least 40: the model reads it to decide when to call the tool (step 1)',
      'planner has 0 tools, expected 3 (step 2)',
      'PLANNER_INSTRUCTIONS has 19 characters, expected at least 200 (step 2)',
      'feedback rows: 0, expected 3 (step 1 or 2: submitFeedback.execute must call postFeedback and the planner must list it)',
    ]);
  });

  test('names each loose bound of the input schema, wrong tool keys, TODO in the instructions and a crashing run', async () => {
    // Arrange
    const loose = createTool({
      id: 'submitFeedback',
      description: 'x'.repeat(50),
      inputSchema: z.object({ slot: z.string(), thumb: z.string(), reason: z.string() }),
      execute: async () => ({ ok: true }),
    });
    const inputs = solvedInputs();

    // Act
    const lines = await staticChecks03({
      ...inputs,
      submitFeedback: loose as ToolLike,
      planner: {
        listTools: async () => ({ getTimetable: {}, searchArchive: {}, feedback: {} }),
        getInstructions: () => `TODO ${'x'.repeat(300)}`,
      },
      runTwoTurns: async () => {
        throw new Error('boom');
      },
    });

    // Assert
    expect(failing(lines)).toEqual([
      'accepts slot 13:30; use Slot (step 1)',
      "accepts thumb 'meh'; use z.enum(['up', 'down']) (step 1)",
      'accepts a 281-character reason; add .max(280) (step 1)',
      'missing submitFeedback; the keys must be getTimetable, searchArchive, submitFeedback (step 2)',
      'PLANNER_INSTRUCTIONS still contains TODO (step 2)',
      'boom (step 1 or 2; read the message)',
    ]);
  });

  test('a tool without a schema, or rows with a repeated slot, fail', async () => {
    const inputs = solvedInputs();
    const lines = await staticChecks03({
      ...inputs,
      submitFeedback: { description: 'x'.repeat(50) },
      runTwoTurns: async () => [{ slot: '14:15' }, { slot: '14:15' }, { slot: '16:30' }],
    });
    expect(failing(lines)).toEqual([
      'submitFeedback has no input schema (step 1)',
      'feedback rows: 3, expected 3 (step 1 or 2: submitFeedback.execute must call postFeedback and the planner must list it)',
    ]);
  });
});
