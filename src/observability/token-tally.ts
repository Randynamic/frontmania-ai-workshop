import type { ObservabilityExporter, TracingEvent } from '@mastra/core/observability';

/**
 * In-process exporter that adds up the token usage of every model call in
 * a run, so a CLI can print `tokens: <n>` without asking MLflow. Reads the
 * `usage` attribute of ended `model_generation` spans (observed 26 Sep 2026
 * on @mastra/core 1.71.0: `{ inputTokens, outputTokens, ... }`).
 */
const MODEL_GENERATION = 'model_generation';

interface UsageLike {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

const usageOf = (span: unknown): UsageLike | undefined => {
  if (!span || typeof span !== 'object') return undefined;
  const attributes = (span as { attributes?: { usage?: unknown } }).attributes;
  const usage = attributes?.usage;
  return usage && typeof usage === 'object' ? (usage as UsageLike) : undefined;
};

export class TokenTallyExporter implements ObservabilityExporter {
  readonly name = 'token-tally';
  private inputTokens = 0;
  private outputTokens = 0;
  private modelCalls = 0;

  async exportTracingEvent(event: TracingEvent): Promise<void> {
    if (event.type !== 'span_ended') return;
    const span = event.exportedSpan as { type?: string };
    if (span.type !== MODEL_GENERATION) return;
    const usage = usageOf(span);
    this.modelCalls += 1;
    this.inputTokens += usage?.inputTokens ?? 0;
    this.outputTokens += usage?.outputTokens ?? 0;
  }

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {}

  /** Totals so far; `total` is null until at least one model call ended. */
  snapshot(): {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly total: number | null;
    readonly modelCalls: number;
  } {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      total: this.modelCalls > 0 ? this.inputTokens + this.outputTokens : null,
      modelCalls: this.modelCalls,
    };
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.modelCalls = 0;
  }
}
