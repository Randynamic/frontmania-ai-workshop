import { createStep, createWorkflow } from '@mastra/core/workflows';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { loadPersonas } from '../../../src/data/personas.js';
import { AGENTS, createMastra } from '../../../src/mastra/index.js';
import { expandSlots } from '../../../src/mastra/workflows/steps/expand-slots.js';
import { NotImplementedError } from '../../../src/not-implemented.js';
import { Plan, PlanInput, SlotInput } from '../../../src/schemas/plan.js';
import { SlotRanking } from '../../../src/schemas/slot-ranking.js';
import { loadPrompt } from '../../../src/prompts/load.js';
import { renderPrompt, serializeProfile, serializeTalks } from '../../../src/prompts/render.js';
import { solvedPlanWorkflow } from '../../../src/test-support/solved-plan-workflow.js';
import { foreachConcurrency, staticChecks02 } from './static.js';

/**
 * Branch-independent: the solved state is the test-support reference
 * workflow, the start state is rebuilt inline (rankSlot throwing,
 * concurrency 1, tip step without retrieval), so this file is green on
 * 02-start and 02-done. The real files are exercised by `pnpm check:02`.
 */
const profile = loadPersonas()[1]!.profile;
const cleanSources = { rankSlot: 'solved', plan: 'solved', tip: 'solved' };
const startSources = {
  rankSlot: '// TODO(exercise 02, step 1): implement rankSlot',
  plan: '// TODO(exercise 02, step 2): concurrency',
  tip: '// TODO(exercise 02, step 3): retrieval',
};

const startRankSlot = createStep({
  id: 'rankSlot',
  inputSchema: SlotInput,
  outputSchema: SlotRanking,
  execute: async () => {
    throw new NotImplementedError('rankSlot (exercise 02, step 1)');
  },
});
const noTipStep = createStep({
  id: 'tip',
  inputSchema: z.array(SlotRanking),
  outputSchema: Plan,
  execute: async ({ inputData }) => ({ rankings: inputData, tips: [] }),
});
const startWorkflow = createWorkflow({ id: 'plan', inputSchema: PlanInput, outputSchema: Plan })
  .then(expandSlots)
  .foreach(startRankSlot, { concurrency: 1 })
  .then(noTipStep)
  .commit();
const rankingOnly = createStep({
  id: 'rankSlot',
  inputSchema: SlotInput,
  outputSchema: SlotRanking,
  execute: async ({ inputData, mastra }) => {
    const { template } = await loadPrompt('ranker');
    const prompt = renderPrompt(template, {
      profile: serializeProfile(inputData.profile),
      slot: inputData.slot,
      talks: serializeTalks(inputData.talks),
    });
    const result = await mastra.getAgent('ranker').generate(prompt, {
      structuredOutput: { schema: SlotRanking, errorStrategy: 'strict' },
    });
    return result.object;
  },
});
const halfWorkflow = createWorkflow({ id: 'plan', inputSchema: PlanInput, outputSchema: Plan })
  .then(expandSlots)
  .foreach(rankingOnly, { concurrency: 3 })
  .then(noTipStep)
  .commit();

const mastraFor = (workflow: typeof startWorkflow) =>
  createMastra({ MODEL_MODE: 'mock' }, { agents: AGENTS, workflows: { plan: workflow } });

describe('staticChecks02', () => {
  test('passes on the solved state', async () => {
    const lines = await staticChecks02({
      mastra: mastraFor(solvedPlanWorkflow),
      sources: cleanSources,
      profile,
    });
    expect(lines.filter((l) => l.status !== 'OK')).toEqual([]);
    expect(lines.map((l) => l.name)).toContain('three tips from the archive');
  });

  test('on the start state every FAIL names its step', async () => {
    const mastra = mastraFor(startWorkflow);
    expect(foreachConcurrency(mastra)).toBe(1);
    const lines = await staticChecks02({ mastra, sources: startSources, profile });
    const failures = lines.filter((l) => l.status === 'FAIL');
    expect(failures.map((l) => l.name)).toEqual([
      'no exercise marker in src/mastra/workflows/steps/rank-slot.ts',
      'no exercise marker in src/mastra/workflows/plan.ts',
      'no exercise marker in src/mastra/workflows/steps/tip.ts',
      'rankSlot fans out',
      'mock run of the plan workflow',
    ]);
    expect(failures.find((l) => l.name === 'rankSlot fans out')?.detail).toBe(
      'rankSlot runs with concurrency 1, expected 3 (step 2)',
    );
    expect(failures.find((l) => l.name === 'mock run of the plan workflow')?.detail).toBe(
      'rankSlot not implemented (step 1)',
    );
    for (const line of failures) expect(line.detail).toMatch(/\(step [123]\)$/);
  });

  test('rankSlot done but no retrieval yet: tips 0 of 3 (step 3)', async () => {
    const lines = await staticChecks02({
      mastra: mastraFor(halfWorkflow),
      sources: cleanSources,
      profile,
    });
    const failures = lines.filter((l) => l.status === 'FAIL');
    expect(failures.map((l) => l.detail)).toEqual([
      'tips: expected 3, got 0; hits is still empty, fill it from searchArchive (step 3)',
    ]);
  });

  test('a workflow without a foreach is reported', () => {
    const flat = createWorkflow({ id: 'plan', inputSchema: PlanInput, outputSchema: Plan })
      .then(expandSlots)
      .then(
        createStep({
          id: 'x',
          inputSchema: z.array(SlotInput),
          outputSchema: Plan,
          execute: async () => ({ rankings: [], tips: [] }),
        }),
      )
      .commit();
    expect(foreachConcurrency(mastraFor(flat as never))).toBeUndefined();
  });
});
