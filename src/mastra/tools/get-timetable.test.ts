import { describe, expect, test } from 'vitest';
import { SLOTS } from '../../schemas/talk.js';
import { getTimetable, GetTimetableInput, GetTimetableOutput, timetable } from './get-timetable.js';

describe('getTimetable', () => {
  test('returns only the talks of the named slot', () => {
    // Act
    const { talks } = timetable('15:30');

    // Assert
    expect(talks.length).toBeGreaterThan(0);
    expect(new Set(talks.map((t) => t.slot))).toEqual(new Set(['15:30']));
  });

  test('returns all three slots in SLOTS order without a slot', () => {
    const { talks } = timetable(undefined);
    const firstIndex = SLOTS.map((slot) => talks.findIndex((t) => t.slot === slot));
    expect(firstIndex.every((i) => i >= 0)).toBe(true);
    expect([...firstIndex].sort((a, b) => a - b)).toEqual(firstIndex);
    expect(GetTimetableOutput.safeParse({ talks }).success).toBe(true);
  });

  test('the input schema refuses a slot outside the afternoon', () => {
    expect(GetTimetableInput.safeParse({ slot: '13:30' }).success).toBe(false);
    expect(GetTimetableInput.safeParse({}).success).toBe(true);
  });

  test('execute goes through the tool wrapper and validates the output', async () => {
    const result = (await getTimetable.execute!({ slot: '16:30' }, {} as never)) as {
      talks: { slot: string }[];
    };
    expect(result.talks.every((t) => t.slot === '16:30')).toBe(true);
    expect(getTimetable.description.length).toBeGreaterThan(40);
  });
});
