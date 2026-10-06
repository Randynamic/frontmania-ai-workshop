import { describe, expect, test } from 'vitest';
import { loadPersonas } from '../../../data/personas.js';
import { SlotInput } from '../../../schemas/plan.js';
import { SLOTS } from '../../../schemas/talk.js';
import { expandSlots, programOnce } from './expand-slots.js';

describe('expandSlots', () => {
  test("yields one SlotInput per slot in SLOTS order with that slot's talks", async () => {
    // Arrange
    const profile = loadPersonas()[1]!.profile;

    // Act
    const out = (await expandSlots.execute({ inputData: { profile } } as never)) as SlotInput[];

    // Assert
    expect(out.map((s) => s.slot)).toEqual([...SLOTS]);
    for (const item of out) {
      expect(SlotInput.safeParse(item).success).toBe(true);
      expect(item.talks.every((talk) => talk.slot === item.slot)).toBe(true);
      expect(item.profile).toEqual(profile);
    }
    expect(out.map((s) => s.talks.length)).toEqual([6, 6, 4]);
    expect(programOnce()).toBe(programOnce());
  });
});
