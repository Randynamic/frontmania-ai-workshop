/**
 * MLflow stores an OTLP-ingested trace under `tr-` + the 32-hex OTel trace
 * id. Verified 26 Sep 2026 on MLflow 3.16.1: Mastra reported
 * `446ae47eb395812155265a4e51014e75`, traces/search returned
 * `tr-446ae47eb395812155265a4e51014e75`.
 */
export const MLFLOW_TRACE_PREFIX = 'tr-';
const OTEL_TRACE_ID = /^[0-9a-f]{32}$/i;

export const isOtelTraceId = (value: string): boolean => OTEL_TRACE_ID.test(value);

export const toMlflowTraceId = (otelTraceId: string): string => {
  const trimmed = otelTraceId.trim();
  if (trimmed.startsWith(MLFLOW_TRACE_PREFIX)) return trimmed;
  if (!isOtelTraceId(trimmed)) {
    throw new Error(`toMlflowTraceId: expected a 32-hex OTel trace id, got "${otelTraceId}"`);
  }
  return `${MLFLOW_TRACE_PREFIX}${trimmed.toLowerCase()}`;
};

export const toOtelTraceId = (mlflowTraceId: string): string =>
  mlflowTraceId.startsWith(MLFLOW_TRACE_PREFIX)
    ? mlflowTraceId.slice(MLFLOW_TRACE_PREFIX.length)
    : mlflowTraceId;
