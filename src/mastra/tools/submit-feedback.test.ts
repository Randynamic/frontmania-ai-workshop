import { afterEach, describe, expect, test } from 'vitest';
import { clearCurrentRun, setCurrentRun } from '../../feedback/current-run.js';
import { clearSunkFeedback, sunkFeedback } from '../../feedback/sink.js';
import { submitFeedback } from './submit-feedback.js';

/** Exercise 3, step 1 (03-done only): the tool the planner calls once per slot. */
afterEach(() => {
  clearSunkFeedback();
  clearCurrentRun();
});

const schema = submitFeedback.inputSchema as unknown as {
  safeParse: (value: unknown) => { success: boolean };
};
const valid = { slot: '14:15', thumb: 'up', reason: 'fits my stack' };

describe('submitFeedback', () => {
  test('accepts a verdict and refuses a slot, a thumb or a reason out of bounds', () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, slot: '13:30' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, thumb: 'meh' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, reason: 'x'.repeat(281) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, reason: 'x'.repeat(280) }).success).toBe(true);
  });

  test('has a description the model can act on', () => {
    expect(submitFeedback.id).toBe('submitFeedback');
    expect(submitFeedback.description).toMatch(/once per slot/);
  });

  test('execute posts once with the current run trace id', async () => {
    // Arrange
    setCurrentRun({ traceId: 'tr-plan', kind: 'agent' });

    // Act
    const result = await submitFeedback.execute!(
      { slot: '15:30', thumb: 'down', reason: 'too basic' },
      {} as never,
    );

    // Assert
    expect(result).toEqual({ ok: true, id: 'mock-1' });
    expect(sunkFeedback()).toEqual([
      { slot: '15:30', thumb: 'down', reason: 'too basic', traceId: 'tr-plan', id: 'mock-1' },
    ]);
  });
});
