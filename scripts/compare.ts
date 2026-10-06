import type { ObservabilityExporter, TracingEvent } from '@mastra/core/observability';
import { formatCompare, runCompare } from './compare/run.js';

/** Remembers the trace id of each finished root span (one per variant) so both runs can be registered. */
class RootTraceExporter implements ObservabilityExporter {
  readonly name = 'root-trace';
  private ids: string[] = [];
  async exportTracingEvent(event: TracingEvent): Promise<void> {
    if (event.type !== 'span_ended') return;
    const span = event.exportedSpan as { isRootSpan?: boolean; traceId?: string };
    if (span.isRootSpan && span.traceId) this.ids = [...this.ids, span.traceId];
  }
  async flush(): Promise<void> {}
  async shutdown(): Promise<void> {}
  take(): string | undefined {
    const [first, ...rest] = this.ids;
    this.ids = rest;
    return first ? `tr-${first}` : undefined;
  }
}

const main = async (): Promise<void> => {
  const { AGENTS, createMastra, WORKFLOWS } = await import('../src/mastra/index.js');
  const roots = new RootTraceExporter();
  const mastra = createMastra(process.env, {
    agents: AGENTS,
    workflows: WORKFLOWS,
    exporters: [roots],
  });
  const result = await runCompare(process.argv.slice(2), {
    env: process.env,
    mastra,
    nextTraceId: () => roots.take(),
  });
  console.log(formatCompare(result));
};

main().catch((error: unknown) => {
  console.error(`pnpm compare failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
