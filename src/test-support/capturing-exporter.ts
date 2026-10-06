import type { ObservabilityExporter, TracingEvent } from '@mastra/core/observability';

/**
 * Test-only exporter: keeps every ended span in memory. What this exporter
 * sees is exactly what MLflow would receive, after the masking processor.
 */
export class CapturingExporter implements ObservabilityExporter {
  readonly name = 'capture';
  readonly spans: unknown[] = [];

  async exportTracingEvent(event: TracingEvent): Promise<void> {
    if (event.type === 'span_ended') this.spans.push(event.exportedSpan);
  }

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {}

  serialized(): string {
    return JSON.stringify(this.spans);
  }
}
