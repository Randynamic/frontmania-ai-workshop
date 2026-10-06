import { describe, expect, test } from 'vitest';
import { TokenTallyExporter } from './token-tally.js';

const ended = (span: Record<string, unknown>) =>
  ({ type: 'span_ended', exportedSpan: span }) as never;

describe('TokenTallyExporter', () => {
  test('sums model_generation usage and ignores other spans and events', async () => {
    const tally = new TokenTallyExporter();
    expect(tally.snapshot().total).toBeNull();
    await tally.exportTracingEvent(
      ended({
        type: 'model_generation',
        attributes: { usage: { inputTokens: 100, outputTokens: 7 } },
      }),
    );
    await tally.exportTracingEvent(
      ended({ type: 'model_generation', attributes: { usage: { inputTokens: 50 } } }),
    );
    await tally.exportTracingEvent(
      ended({ type: 'agent_run', attributes: { usage: { inputTokens: 999 } } }),
    );
    await tally.exportTracingEvent({ type: 'span_started', span: {} } as never);
    expect(tally.snapshot()).toEqual({
      inputTokens: 150,
      outputTokens: 7,
      total: 157,
      modelCalls: 2,
    });
    await tally.flush();
    await tally.shutdown();
    tally.reset();
    expect(tally.snapshot().modelCalls).toBe(0);
  });
});
