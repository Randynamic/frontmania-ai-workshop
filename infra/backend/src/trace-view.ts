import type { RawTrace } from './mlflow.js';

/**
 * Normalises an MLflow v3 trace into the shape the check scripts read.
 *
 * Verified 26 Sep 2026 against a running MLflow 3.16.1 with one Mastra
 * 1.71.0 trace ingested over OTLP (fixture: fixtures/mlflow-3.16.1-trace.json):
 * - `GET /api/3.0/mlflow/traces/get?trace_id=` returns `{ trace: { trace_info, spans } }`.
 * - Span attributes are OTLP AnyValue arrays: `string_value`, `int_value`,
 *   `bool_value`, `double_value`, and nested `kvlist_value` / `array_value`.
 * - Inputs and outputs sit under `mastra.<span type>.input|output`; only the
 *   model call carries `mlflow.spanInputs|spanOutputs`.
 * - Tokens: `mlflow.chat.tokenUsage.total_tokens` on the model call span,
 *   and `trace_info.trace_metadata['mlflow.trace.tokenUsage']` (JSON string)
 *   for the whole trace.
 * - Times: `start_time_unix_nano` / `end_time_unix_nano` as decimal strings.
 */
export interface SpanView {
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly attributes: Record<string, unknown>;
}

export interface TraceView {
  readonly found: true;
  readonly traceId: string;
  readonly tokens: number | null;
  readonly latencyMs: number | null;
  readonly spans: readonly SpanView[];
  readonly assessments: readonly unknown[];
}

const INPUT_KEYS = ['mlflow.spanInputs'] as const;
const OUTPUT_KEYS = ['mlflow.spanOutputs'] as const;
const SPAN_TYPE_KEY = 'mastra.span.type';
const TRACE_TOKEN_USAGE_KEY = 'mlflow.trace.tokenUsage';
const SPAN_TOKEN_USAGE_KEYS = ['mlflow.chat.tokenUsage', 'llm.token_count'] as const;
const TOTAL_TOKEN_KEYS = ['gen_ai.usage.total_tokens', 'llm.token_count.total'] as const;
const INPUT_TOKEN_KEY = 'gen_ai.usage.input_tokens';
const OUTPUT_TOKEN_KEY = 'gen_ai.usage.output_tokens';
const NANOS_PER_MS = 1_000_000;

interface OtlpKeyValue {
  key?: string;
  value?: OtlpValue;
}
interface OtlpValue {
  string_value?: string;
  stringValue?: string;
  int_value?: string | number;
  intValue?: string | number;
  double_value?: number;
  doubleValue?: number;
  bool_value?: boolean;
  boolValue?: boolean;
  kvlist_value?: { values?: OtlpKeyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
  array_value?: { values?: OtlpValue[] };
  arrayValue?: { values?: OtlpValue[] };
}

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const decodeKvList = (values: readonly OtlpKeyValue[] | undefined): Record<string, unknown> =>
  Object.fromEntries(
    (values ?? [])
      .filter((entry) => typeof entry.key === 'string')
      .map((entry) => [entry.key as string, decodeOtlpValue(entry.value)]),
  );

/** Recursive OTLP AnyValue decoder (snake_case and camelCase field names); strings stay strings. */
export const decodeOtlpValue = (value: OtlpValue | undefined): unknown => {
  if (!value) return undefined;
  const text = value.string_value ?? value.stringValue;
  if (text !== undefined) return text;
  const int = value.int_value ?? value.intValue;
  if (int !== undefined) return Number(int);
  const double = value.double_value ?? value.doubleValue;
  if (double !== undefined) return double;
  const bool = value.bool_value ?? value.boolValue;
  if (bool !== undefined) return bool;
  const kvList = value.kvlist_value ?? value.kvlistValue;
  if (kvList) return decodeKvList(kvList.values);
  const array = value.array_value ?? value.arrayValue;
  if (array) return (array.values ?? []).map(decodeOtlpValue);
  return undefined;
};

const parseTopLevel = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k, parseMaybeJson(v)]));

/** Accepts OTLP attribute arrays and plain records; top-level JSON strings are parsed. */
export const flattenAttributes = (raw: unknown): Record<string, unknown> => {
  if (Array.isArray(raw)) return parseTopLevel(decodeKvList(raw as OtlpKeyValue[]));
  if (raw && typeof raw === 'object') return parseTopLevel(raw as Record<string, unknown>);
  return {};
};

const nanosToMs = (value: unknown): number =>
  value === undefined ? 0 : Number(value) / NANOS_PER_MS;

const firstDefined = (attributes: Record<string, unknown>, keys: readonly string[]): unknown =>
  keys.map((key) => attributes[key]).find((value) => value !== undefined);

/** `mastra.<type>.input` for the span's own type, else the MLflow convention key. */
const spanIo = (
  attributes: Record<string, unknown>,
  side: 'input' | 'output',
  conventionKeys: readonly string[],
): unknown => {
  const spanType = attributes[SPAN_TYPE_KEY];
  const mastraKey = typeof spanType === 'string' ? `mastra.${spanType}.${side}` : undefined;
  return firstDefined(attributes, [...(mastraKey ? [mastraKey] : []), ...conventionKeys]);
};

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const totalFromUsage = (value: unknown): number | null => {
  const usage = value as { total_tokens?: unknown } | undefined;
  return asNumber(usage?.total_tokens);
};

/** Total tokens of one span: usage object, explicit total, or input + output. */
export const spanTokens = (attributes: Record<string, unknown>): number | null => {
  const fromUsage = SPAN_TOKEN_USAGE_KEYS.map((key) => totalFromUsage(attributes[key])).find(
    (n) => n !== null,
  );
  if (fromUsage !== undefined) return fromUsage;
  const explicit = TOTAL_TOKEN_KEYS.map((key) => asNumber(attributes[key])).find((n) => n !== null);
  if (explicit !== undefined) return explicit;
  const input = asNumber(attributes[INPUT_TOKEN_KEY]);
  const output = asNumber(attributes[OUTPUT_TOKEN_KEY]);
  return input === null && output === null ? null : (input ?? 0) + (output ?? 0);
};

export const toSpanView = (span: Record<string, unknown>): SpanView => {
  const attributes = flattenAttributes(span['attributes']);
  return {
    name: typeof span['name'] === 'string' ? span['name'] : '',
    startMs: nanosToMs(span['start_time_unix_nano'] ?? span['startTimeUnixNano']),
    endMs: nanosToMs(span['end_time_unix_nano'] ?? span['endTimeUnixNano']),
    // null, never undefined: JSON drops undefined keys and the participant schema requires both.
    input: spanIo(attributes, 'input', INPUT_KEYS) ?? null,
    output: spanIo(attributes, 'output', OUTPUT_KEYS) ?? null,
    attributes,
  };
};

/** Trace-level total from trace_metadata (a JSON string in 3.16.1), else the sum over spans. */
const traceTokens = (info: Record<string, unknown>, spans: readonly SpanView[]): number | null => {
  const metadata = info['trace_metadata'] as Record<string, unknown> | undefined;
  const fromTrace = totalFromUsage(parseMaybeJson(metadata?.[TRACE_TOKEN_USAGE_KEY]));
  if (fromTrace !== null) return fromTrace;
  const perSpan = spans
    .map((span) => spanTokens(span.attributes))
    .filter((n): n is number => n !== null);
  return perSpan.length > 0 ? perSpan.reduce((a, b) => a + b, 0) : null;
};

export const toTraceView = (traceId: string, raw: RawTrace): TraceView => {
  const spans = (raw.spans ?? []).map(toSpanView);
  const startMs = Math.min(...spans.map((s) => s.startMs));
  const endMs = Math.max(...spans.map((s) => s.endMs));
  const info = raw.trace_info ?? {};
  const assessments = Array.isArray(info['assessments']) ? (info['assessments'] as unknown[]) : [];
  return {
    found: true,
    traceId,
    tokens: traceTokens(info, spans),
    latencyMs: spans.length > 0 ? Math.round(endMs - startMs) : null,
    spans,
    assessments,
  };
};
