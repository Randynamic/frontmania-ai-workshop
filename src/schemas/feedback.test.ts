import { describe, expect, test } from 'vitest';
import { FeedbackInput, MAX_REASON_LENGTH } from './feedback.js';

describe('FeedbackInput', () => {
  test('accepts a valid verdict', () => {
    expect(FeedbackInput.safeParse({ slot: '14:15', thumb: 'up', reason: 'x' }).success).toBe(true);
  });

  test('rejects an unknown slot, an unknown thumb and a reason over 280 characters', () => {
    expect(FeedbackInput.safeParse({ slot: '13:30', thumb: 'up', reason: 'x' }).success).toBe(
      false,
    );
    expect(FeedbackInput.safeParse({ slot: '14:15', thumb: 'meh', reason: 'x' }).success).toBe(
      false,
    );
    const long = 'a'.repeat(MAX_REASON_LENGTH + 1);
    expect(FeedbackInput.safeParse({ slot: '14:15', thumb: 'down', reason: long }).success).toBe(
      false,
    );
  });
});
