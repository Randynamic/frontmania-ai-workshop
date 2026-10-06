import { describe, expect, test } from 'vitest';
import { loadArchiveTalks } from '../../../src/data/archive.js';
import { loadProgram, talksForSlot } from '../../../src/data/program.js';
import type { LastRun } from '../../../src/run/record.js';
import type { FoundTrace } from '../trace.js';
import { liveChecks02, rankSpanOverlap } from './live.js';

const { program } = loadProgram(undefined, () => undefined);
const firstId = (slot: '14:15' | '15:30' | '16:30') => talksForSlot(program, slot)[0]!.id;
const ranking = (slot: '14:15' | '15:30' | '16:30') => ({
  slot,
  ranking: [firstId(slot)],
  reason: 'r',
  confidence: 0.5,
});
const archiveIds = loadArchiveTalks().talks.map((t) => t.id);
const tips = (['14:15', '15:30', '16:30'] as const).map((slot, i) => ({
  slot,
  archiveTalkId: archiveIds[i]!,
  why: 'w',
}));
const rankings = [ranking('14:15'), ranking('15:30'), ranking('16:30')];
const lastPlan: LastRun = {
  traceId: 'tr-1',
  kind: 'plan',
  tokens: 5000,
  latencyMs: 3000,
  recordedAt: '2026-10-07T09:45:00.000Z',
  plan: { rankings, tips },
};
const lastCompare: LastRun = {
  traceId: 'tr-9',
  kind: 'compare',
  tokens: 9000,
  latencyMs: 4000,
  recordedAt: '2026-10-07T09:50:00.000Z',
};
const span = (name: string, startMs: number, endMs: number) => ({
  name,
  startMs,
  endMs,
  input: null,
  output: null,
  attributes: {},
});
const parallel: FoundTrace = {
  found: true,
  tokens: 4800,
  latencyMs: 2900,
  spans: [
    span("workflow run: 'plan'", 0, 3000),
    span("workflow step: 'rankSlot'", 10, 1000),
    span("workflow step: 'rankSlot'", 12, 1100),
    span("workflow step: 'rankSlot'", 11, 900),
    span("workflow step: 'tip'", 1100, 3000),
  ],
};
const sequential: FoundTrace = {
  ...parallel,
  spans: [
    span("workflow step: 'rankSlot'", 0, 1000),
    span("workflow step: 'rankSlot'", 1000, 2000),
    span("workflow step: 'rankSlot'", 2000, 3000),
  ],
};
const immediate = { now: () => 0, sleep: async () => undefined };

describe('liveChecks02', () => {
  test('a parallel trace passes, prints top picks and the workbook numbers, and warns without compare', async () => {
    const lines = await liveChecks02({
      lastPlan,
      lastCompare: undefined,
      fetchTrace: async () => parallel,
      ...immediate,
    });
    expect(lines.filter((l) => l.status === 'FAIL' || l.status === 'BLOCKED')).toEqual([]);
    expect(lines[0]?.detail).toBe(
      `top picks: 14:15 ${firstId('14:15')} | 15:30 ${firstId('15:30')} | 16:30 ${firstId('16:30')}`,
    );
    expect(lines.find((l) => l.name === 'numbers for the workbook')?.detail).toBe(
      'tokens: 4800  latency: 2900 ms',
    );
    const compare = lines.find((l) => l.name === 'last compare run');
    expect(compare?.status).toBe('WARN');
    expect(compare?.detail).toContain('pnpm compare');
  });

  test('a sequential trace fails the overlap check with step 2; compare numbers print when present', async () => {
    const lines = await liveChecks02({
      lastPlan,
      lastCompare,
      fetchTrace: async () => sequential,
      ...immediate,
    });
    const overlap = lines.find((l) => l.name === 'rankSlot spans overlap in time');
    expect(overlap?.status).toBe('FAIL');
    expect(overlap?.detail).toContain('(step 2)');
    expect(lines.find((l) => l.name === 'last compare run')?.detail).toContain('tokens: 9000');
    expect(rankSpanOverlap(sequential)).toEqual({ count: 3, overlap: false });
    expect(rankSpanOverlap(parallel)).toEqual({ count: 3, overlap: true });
  });

  test('a missing plan in the record or a missing trace stops early', async () => {
    const noPlan = await liveChecks02({
      lastPlan: { ...lastPlan, plan: undefined },
      lastCompare: undefined,
      fetchTrace: async () => parallel,
      ...immediate,
    });
    expect(noPlan).toHaveLength(1);
    expect(noPlan[0]?.status).toBe('FAIL');
    let clock = 0;
    const missing = await liveChecks02({
      lastPlan,
      lastCompare: undefined,
      fetchTrace: async () => ({ found: false }),
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(missing.map((l) => l.status)).toEqual(['OK', 'OK', 'OK', 'OK', 'FAIL']);
  });

  test('a live plan whose ranking names a talk from another slot fails with step 1', async () => {
    // Arrange: the 14:15 ranking carries a 15:30 talk (structured output checks shape, not content)
    const foreign = { ...ranking('14:15'), ranking: [firstId('14:15'), firstId('15:30')] };
    const plan = { rankings: [foreign, ranking('15:30'), ranking('16:30')], tips };

    // Act
    const lines = await liveChecks02({
      lastPlan: { ...lastPlan, plan },
      lastCompare,
      fetchTrace: async () => parallel,
      ...immediate,
    });

    // Assert
    const belong = lines.find((l) => l.name === 'every ranked id belongs to its slot');
    expect(belong?.status).toBe('FAIL');
    expect(belong?.detail).toContain('(step 1)');
    expect(lines.find((l) => l.name === 'three rankings in slot order')?.status).toBe('OK');
  });

  test('a stale plan from before step 3 (no tips) fails the live layer with step 3', async () => {
    // Arrange: last-plan.json written after step 1 or 2, every slot `tip: none`
    const stale: LastRun = { ...lastPlan, plan: { rankings, tips: [] } };

    // Act
    const lines = await liveChecks02({
      lastPlan: stale,
      lastCompare,
      fetchTrace: async () => parallel,
      ...immediate,
    });

    // Assert
    const tipLine = lines.find((l) => l.name === 'three tips from the archive');
    expect(tipLine?.status).toBe('FAIL');
    expect(tipLine?.detail).toBe(
      'last pnpm plan has 0 tips, expected 3; run `pnpm plan` again (step 3)',
    );
  });

  test('a live tip that names an id outside the archive fails with step 3', async () => {
    // Arrange
    const unknown = [...tips.slice(0, 2), { ...tips[2]!, archiveTalkId: 'fm99-not-in-archive' }];

    // Act
    const lines = await liveChecks02({
      lastPlan: { ...lastPlan, plan: { rankings, tips: unknown } },
      lastCompare,
      fetchTrace: async () => parallel,
      ...immediate,
    });

    // Assert
    const tipLine = lines.find((l) => l.name === 'three tips from the archive');
    expect(tipLine?.status).toBe('FAIL');
    expect(tipLine?.detail).toContain('not in the archive');
    expect(tipLine?.detail).toContain('(step 3)');
  });
});
