import { afterEach, describe, expect, test } from 'vitest';
import { postFeedback } from './client.js';
import { clearCurrentRun, setCurrentRun } from './current-run.js';
import { clearSunkFeedback, sinkFeedback, sunkFeedback } from './sink.js';

afterEach(() => {
  clearSunkFeedback();
  clearCurrentRun();
});

describe('feedback sink', () => {
  test('keeps rows in order with sequential mock ids and never mutates earlier snapshots', () => {
    // Arrange
    const before = sunkFeedback();

    // Act
    const first = sinkFeedback({ slot: '14:15', thumb: 'up', reason: 'a', traceId: 'tr-1' });
    const second = sinkFeedback({ slot: '15:30', thumb: 'down', reason: 'b', traceId: 'tr-1' });

    // Assert
    expect(first.id).toBe('mock-1');
    expect(second.id).toBe('mock-2');
    expect(sunkFeedback()).toHaveLength(2);
    expect(before).toHaveLength(0);
  });

  test('postFeedback without a backend config lands in the sink in mock mode', async () => {
    setCurrentRun({ traceId: 'tr-7', kind: 'agent' });
    const receipt = await postFeedback(
      { slot: '16:30', thumb: 'up', reason: 'a11y' },
      { env: { MODEL_MODE: 'mock' } },
    );
    expect(receipt).toEqual({ ok: true, id: 'mock-1' });
    expect(sunkFeedback()).toEqual([
      { slot: '16:30', thumb: 'up', reason: 'a11y', traceId: 'tr-7', id: 'mock-1' },
    ]);
  });

  test('postFeedback in live mode without a backend URL fails with the setup hint', async () => {
    setCurrentRun({ traceId: 'tr-7', kind: 'agent' });
    await expect(
      postFeedback({ slot: '16:30', thumb: 'up', reason: 'a11y' }, { env: { MODEL_MODE: 'live' } }),
    ).rejects.toThrow(/WORKSHOP_BACKEND_URL/);
    expect(sunkFeedback()).toHaveLength(0);
  });
});
