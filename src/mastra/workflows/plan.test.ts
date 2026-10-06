import { describe, expect, test } from 'vitest';
import { loadPersonas } from '../../data/personas.js';
import { loadArchiveTalks } from '../../data/archive.js';
import { loadProgram, talksForSlot } from '../../data/program.js';
import { Plan } from '../../schemas/plan.js';
import { SLOTS } from '../../schemas/talk.js';
import { CapturingExporter } from '../../test-support/capturing-exporter.js';
import { createRankerAgent } from '../agents/ranker.js';
import { createTipAgent } from '../agents/tip.js';
import { createMastra } from '../index.js';
import { createMockTaskModel } from '../model.js';
import { PLAN_WORKFLOW_ID, planWorkflow, RANK_CONCURRENCY } from './plan.js';

const { program } = loadProgram(undefined, () => undefined);
const profile = loadPersonas()[1]!.profile;
const archiveIds = new Set(loadArchiveTalks().talks.map((t) => t.id));
const MODEL_DELAY_MS = 40;

interface SpanLike {
  readonly type: string;
  readonly name: string;
  readonly traceId: string;
  readonly startTime: Date;
  readonly endTime?: Date;
}

const runPlan = async () => {
  const capture = new CapturingExporter();
  const model = createMockTaskModel(undefined, { delayMs: MODEL_DELAY_MS });
  const mastra = createMastra(
    { MODEL_MODE: 'mock' },
    {
      exporters: [capture],
      agents: { ranker: createRankerAgent(model), tip: createTipAgent(model) },
      workflows: { plan: planWorkflow },
    },
  );
  const run = await mastra.getWorkflow(PLAN_WORKFLOW_ID).createRun();
  const started = Date.now();
  const result = await run.start({
    inputData: { profile },
    tracingOptions: { metadata: { participantId: 'otter-42', kind: 'plan' } },
  });
  const elapsedMs = Date.now() - started;
  await mastra.shutdown();
  return { result, elapsedMs, spans: capture.spans as SpanLike[] };
};

describe('planWorkflow', () => {
  test('the graph fans rankSlot out with concurrency 3 (step 2)', () => {
    const foreach = planWorkflow.serializedStepGraph.find((entry) => entry.type === 'foreach');
    expect(foreach).toBeDefined();
    expect(JSON.stringify(foreach)).toContain('"id":"rankSlot"');
    expect(foreach && 'opts' in foreach && foreach.opts?.concurrency).toBe(RANK_CONCURRENCY);
    expect(planWorkflow.serializedStepGraph.map((e) => e.type)).toEqual([
      'step',
      'foreach',
      'step',
    ]);
  });

  test('a mock run yields three rankings in slot order and three tips from the archive, in one trace', async () => {
    // Act
    const { result, elapsedMs, spans } = await runPlan();

    // Assert: shape
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const plan = Plan.parse(result.result);
    expect(plan.rankings.map((r) => r.slot)).toEqual([...SLOTS]);
    for (const ranking of plan.rankings) {
      const slotIds = talksForSlot(program, ranking.slot).map((t) => t.id);
      expect([...ranking.ranking].sort()).toEqual([...slotIds].sort());
    }
    expect(plan.tips).toHaveLength(3);
    for (const tip of plan.tips) expect(archiveIds.has(tip.archiveTalkId)).toBe(true);

    // Assert: one trace, three rankSlot steps that overlap, model calls nested under it
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    const traceIds = new Set(spans.map((s) => s.traceId));
    expect(traceIds).toEqual(new Set([result.traceId]));
    const rankSteps = spans.filter(
      (s) => s.type === 'workflow_step' && s.name.includes('rankSlot'),
    );
    expect(rankSteps).toHaveLength(3);
    const starts = rankSteps.map((s) => s.startTime.getTime());
    const firstEnd = Math.min(...rankSteps.map((s) => s.endTime?.getTime() ?? Infinity));
    expect(Math.max(...starts)).toBeLessThan(firstEnd);
    expect(spans.filter((s) => s.type === 'model_generation')).toHaveLength(6);
    // Parallel: the foreach loop lasts about one rankSlot, not the sum of three.
    const duration = (s: SpanLike) => (s.endTime?.getTime() ?? 0) - s.startTime.getTime();
    const loop = spans.find((s) => s.type === 'workflow_loop');
    const rankSum = rankSteps.reduce((sum, s) => sum + duration(s), 0);
    expect(loop).toBeDefined();
    expect(duration(loop!)).toBeLessThan(rankSum / 2);
    expect(elapsedMs).toBeGreaterThanOrEqual(MODEL_DELAY_MS);
  });
});
