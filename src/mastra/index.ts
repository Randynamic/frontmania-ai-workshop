import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import type { ObservabilityExporter, SpanOutputProcessor } from '@mastra/core/observability';
import type { Workflow } from '@mastra/core/workflows';
import { Observability, TestExporter } from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';
import { archiveVector } from '../data/archive.js';
import { CvMaskingProcessor } from '../observability/mask.js';
import { plannerAgent } from './agents/planner.js';
import { profileAgent } from './agents/profile.js';
import { rankerAgent } from './agents/ranker.js';
import { tipAgent } from './agents/tip.js';
import { modelModeFrom } from './model.js';
import { planWorkflow } from './workflows/plan.js';

/**
 * The Mastra instance every script and agent uses. It carries the vector
 * store, the observability pipeline, the agents (exercise 1: `profile`;
 * exercise 2: `ranker` and `tip`; exercise 3: `planner`, with tools) and the
 * `plan` workflow of exercise 2.
 *
 * Tracing: every span passes through CvMaskingProcessor before export, so
 * registered participant text leaves the process as `[cv:sha256:...]`. In
 * live mode spans go to MLflow over OTLP through the gateway with the proxy
 * key as bearer; in MODEL_MODE=mock an in-memory TestExporter stands in and
 * the processor still runs, which is what src/mastra/index.test.ts proves
 * offline.
 *
 * Verified 26 Sep 2026 against the installed packages and a running MLflow
 * 3.16.1: `Mastra.observability` takes an `Observability` instance
 * (@mastra/core 1.71.0 mastra/index.d.ts); OtelExporter `provider.custom`
 * sends the endpoint as given with `protocol: 'http/protobuf'`; MLflow has
 * no /v1/logs, so the logs signal is off.
 */
export const SERVICE_NAME = 'talk-picker';
export const ARCHIVE_VECTOR_NAME = 'archive';
export const OTLP_TRACES_SUFFIX = '/v1/traces';

export interface ObservabilityOptions {
  /** Extra exporters, used by tests to capture spans in memory. */
  readonly exporters?: readonly ObservabilityExporter[];
}

export const createOtelExporter = (
  env: Readonly<Record<string, string | undefined>>,
): OtelExporter => {
  const endpoint = env.MLFLOW_OTLP_ENDPOINT?.trim() ?? '';
  const apiKey = env.PROXY_API_KEY?.trim() ?? '';
  if (!endpoint.endsWith(OTLP_TRACES_SUFFIX)) {
    throw new Error(
      `MLFLOW_OTLP_ENDPOINT must end with ${OTLP_TRACES_SUFFIX}; copy .env.example to .env`,
    );
  }
  if (!apiKey) throw new Error('PROXY_API_KEY is empty; paste the key from your card into .env');
  return new OtelExporter({
    provider: {
      custom: {
        endpoint,
        headers: { Authorization: `Bearer ${apiKey}` },
        protocol: 'http/protobuf',
      },
    },
    signals: { traces: true, logs: false },
  });
};

/** The `default` observability config: masking always, OTLP export in live mode, in-memory export in mock mode. */
export const createObservabilityConfig = (
  env: Readonly<Record<string, string | undefined>>,
  options: ObservabilityOptions = {},
): {
  readonly serviceName: string;
  readonly exporters: ObservabilityExporter[];
  readonly spanOutputProcessors: SpanOutputProcessor[];
} => {
  const exporters = [
    ...(modelModeFrom(env) === 'mock' ? [] : [createOtelExporter(env)]),
    ...(options.exporters ?? []),
  ];
  return {
    serviceName: SERVICE_NAME,
    // @mastra/observability 1.18.1 refuses an instance without an exporter or
    // bridge, so mock mode gets an in-memory TestExporter: no socket, spans
    // still pass through the masking processor.
    exporters: exporters.length > 0 ? exporters : [new TestExporter()],
    spanOutputProcessors: [new CvMaskingProcessor()],
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra's own registration type; a workflow's generics are erased here.
type AnyWorkflow = Workflow<any, any, any, any, any, any, any, any>;

export interface MastraOptions extends ObservabilityOptions {
  readonly agents?: Record<string, Agent>;
  readonly workflows?: Record<string, AnyWorkflow>;
}

export const createMastra = (
  env: Readonly<Record<string, string | undefined>>,
  options: MastraOptions = {},
): Mastra =>
  new Mastra({
    ...(options.agents ? { agents: options.agents } : {}),
    ...(options.workflows ? { workflows: options.workflows } : {}),
    vectors: { [ARCHIVE_VECTOR_NAME]: archiveVector() },
    observability: new Observability({
      configs: { default: createObservabilityConfig(env, options) },
    }),
    logger: false,
  });

/** Agents registered on this branch; scripts fetch them with `mastra.getAgent(<key>)`. */
export const AGENTS = {
  profile: profileAgent,
  ranker: rankerAgent,
  tip: tipAgent,
  planner: plannerAgent,
} as const;

/** Workflows registered on this branch; scripts fetch them with `mastra.getWorkflow(<key>)`. */
export const WORKFLOWS = { plan: planWorkflow } as const;

export const mastra = createMastra(process.env, { agents: AGENTS, workflows: WORKFLOWS });
