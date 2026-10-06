import { describe, expect, test } from 'vitest';
import { Plan } from './plan.js';
import { MAX_REASON_LENGTH, SlotRanking } from './slot-ranking.js';
import { MAX_WHY_LENGTH, Tip } from './tip.js';

const ranking = (slot: '14:15' | '15:30' | '16:30') => ({
  slot,
  ranking: ['fm26-1', 'fm26-2'],
  reason: 'closest to the stack',
  confidence: 0.7,
});

describe('SlotRanking', () => {
  test('accepts a ranking and rejects an empty list, a bad id, a long reason and confidence > 1', () => {
    expect(SlotRanking.safeParse(ranking('14:15')).success).toBe(true);
    expect(SlotRanking.safeParse({ ...ranking('14:15'), ranking: [] }).success).toBe(false);
    expect(SlotRanking.safeParse({ ...ranking('14:15'), ranking: ['nope'] }).success).toBe(false);
    expect(
      SlotRanking.safeParse({ ...ranking('14:15'), reason: 'a'.repeat(MAX_REASON_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(SlotRanking.safeParse({ ...ranking('14:15'), confidence: 1.2 }).success).toBe(false);
  });
});

describe('Tip', () => {
  test('needs a slot, an archive talk id and a bounded why', () => {
    expect(
      Tip.safeParse({ slot: '15:30', archiveTalkId: 'fm25-9', why: 'same topic' }).success,
    ).toBe(true);
    expect(
      Tip.safeParse({ slot: '15:30', archiveTalkId: 'fm25-9', why: 'a'.repeat(MAX_WHY_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(Tip.safeParse({ slot: '12:00', archiveTalkId: 'fm25-9', why: 'x' }).success).toBe(false);
  });
});

describe('Plan', () => {
  test('needs exactly three rankings and allows zero to three tips', () => {
    const rankings = [ranking('14:15'), ranking('15:30'), ranking('16:30')];
    expect(Plan.safeParse({ rankings, tips: [] }).success).toBe(true);
    expect(
      Plan.safeParse({
        rankings,
        tips: [{ slot: '14:15', archiveTalkId: 'fm25-1', why: 'w' }],
      }).success,
    ).toBe(true);
    expect(Plan.safeParse({ rankings: rankings.slice(0, 2), tips: [] }).success).toBe(false);
    const tip = { slot: '14:15', archiveTalkId: 'fm25-1', why: 'w' };
    expect(Plan.safeParse({ rankings, tips: [tip, tip, tip, tip] }).success).toBe(false);
  });
});
