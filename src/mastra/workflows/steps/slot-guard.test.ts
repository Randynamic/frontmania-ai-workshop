import { describe, expect, test } from 'vitest';
import { loadProgram, talksForSlot } from '../../../data/program.js';
import { ForeignTalkError, keepToSlot } from './slot-guard.js';

const { program } = loadProgram(undefined, () => undefined);
const talks = [...talksForSlot(program, '14:15')];
const otherSlotId = talksForSlot(program, '15:30')[0]!.id;
const answer = {
  slot: '14:15' as const,
  ranking: talks.map((t) => t.id),
  reason: 'r',
  confidence: 0.7,
};

describe('keepToSlot', () => {
  test('passes a ranking of the slot through unchanged', () => {
    expect(keepToSlot(answer, { slot: '14:15', talks })).toEqual(answer);
  });

  test('sets the slot from the input when the model names another one', () => {
    // Arrange
    const wrongSlot = { ...answer, slot: '16:30' as const };

    // Act
    const kept = keepToSlot(wrongSlot, { slot: '14:15', talks });

    // Assert
    expect(kept.slot).toBe('14:15');
    expect(wrongSlot.slot).toBe('16:30');
  });

  test('rejects ids outside the slot and names them', () => {
    const foreign = { ...answer, ranking: [talks[0]!.id, otherSlotId] };
    expect(() => keepToSlot(foreign, { slot: '14:15', talks })).toThrow(ForeignTalkError);
    expect(() => keepToSlot(foreign, { slot: '14:15', talks })).toThrow(
      `outside slot 14:15: ${otherSlotId}; run again (step 1)`,
    );
  });
});
