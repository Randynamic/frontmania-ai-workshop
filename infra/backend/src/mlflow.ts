/**
 * Minimal MLflow 3.16.1 REST client. Every route below was exercised on
 * 26 Sep 2026 against a running ghcr.io/mlflow/mlflow:v3.16.1 with one Mastra
 * 1.71.0 trace ingested over OTLP (observed JSON in fixtures/): traces/get is
 * `GET ?trace_id=` (POST answers 405), traces/search and delete-traces are
 * POST, assessments take `{ assessment: {...} }`, and the prompt alias read
 * is the two registered-model GETs. Field names are the server's snake_case.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface MlflowClientOptions {
  readonly baseUrl: string;
  readonly experimentId: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export interface AssessmentInput {
  readonly traceId: string;
  readonly name: string;
  readonly sourceId: string;
  readonly rationale?: string;
  readonly metadata?: Record<string, string>;
  readonly feedback?: unknown;
  readonly expectation?: unknown;
}

export interface PromptVersion {
  readonly name: string;
  readonly alias: string;
  readonly version: string;
  readonly template: string;
}

export interface RawTrace {
  readonly trace_info?: Record<string, unknown>;
  readonly spans?: readonly Record<string, unknown>[];
}

const DEFAULT_TIMEOUT_MS = 5_000;
const PROMPT_TEXT_TAG = 'mlflow.prompt.text';
const DELETE_BATCH = 500;

export class MlflowError extends Error {
  constructor(
    readonly status: number,
    readonly route: string,
    body: string,
  ) {
    super(`mlflow ${route} -> ${status}: ${body.slice(0, 200)}`);
  }
}

export class MlflowClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  readonly experimentId: string;
  private readonly baseUrl: string;

  constructor(options: MlflowClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.experimentId = options.experimentId;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async call<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new MlflowError(response.status, route, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Returns undefined when the trace is not (yet) ingested. */
  async getTrace(traceId: string): Promise<RawTrace | undefined> {
    try {
      const result = await this.call<{ trace?: RawTrace }>(
        'GET',
        `/api/3.0/mlflow/traces/get?trace_id=${encodeURIComponent(traceId)}`,
      );
      return result.trace;
    } catch (error) {
      if (error instanceof MlflowError && error.status === 404) return undefined;
      throw error;
    }
  }

  async searchTraceIds(maxResults = DELETE_BATCH): Promise<readonly string[]> {
    const result = await this.call<{ traces?: { trace_id?: string }[] }>(
      'POST',
      '/api/3.0/mlflow/traces/search',
      {
        locations: [
          { type: 'MLFLOW_EXPERIMENT', mlflow_experiment: { experiment_id: this.experimentId } },
        ],
        max_results: maxResults,
      },
    );
    return (result.traces ?? [])
      .map((t) => t.trace_id)
      .filter((id): id is string => typeof id === 'string');
  }

  /** Deletes every trace in the experiment in batches; returns the total deleted. */
  async deleteAllTraces(now = Date.now()): Promise<number> {
    const deleteBatch = async (total: number): Promise<number> => {
      const result = await this.call<{ traces_deleted?: number }>(
        'POST',
        '/api/3.0/mlflow/traces/delete-traces',
        {
          experiment_id: this.experimentId,
          max_timestamp_millis: now,
          max_traces: DELETE_BATCH,
        },
      );
      const deleted = result.traces_deleted ?? 0;
      return deleted === 0 ? total : deleteBatch(total + deleted);
    };
    return deleteBatch(0);
  }

  async createAssessment(input: AssessmentInput): Promise<void> {
    const value =
      input.feedback !== undefined
        ? { feedback: { value: input.feedback } }
        : { expectation: { value: input.expectation } };
    await this.call(
      'POST',
      `/api/3.0/mlflow/traces/${encodeURIComponent(input.traceId)}/assessments`,
      {
        assessment: {
          trace_id: input.traceId,
          assessment_name: input.name,
          source: { source_type: 'HUMAN', source_id: input.sourceId },
          ...value,
          ...(input.rationale ? { rationale: input.rationale } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
      },
    );
  }

  /** Prompt registry read: alias -> version -> tag mlflow.prompt.text. */
  async getPromptByAlias(name: string, alias: string): Promise<PromptVersion> {
    const byAlias = await this.call<{ model_version?: { version?: string } }>(
      'GET',
      `/api/2.0/mlflow/registered-models/alias?name=${encodeURIComponent(name)}&alias=${encodeURIComponent(alias)}`,
    );
    const version = byAlias.model_version?.version;
    if (!version)
      throw new MlflowError(404, 'registered-models/alias', `no version for ${name}@${alias}`);
    const detail = await this.call<{
      model_version?: { tags?: { key?: string; value?: string }[] };
    }>(
      'GET',
      `/api/2.0/mlflow/model-versions/get?name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`,
    );
    const template = detail.model_version?.tags?.find((tag) => tag.key === PROMPT_TEXT_TAG)?.value;
    if (typeof template !== 'string')
      throw new MlflowError(
        404,
        'model-versions/get',
        `${name} v${version} has no ${PROMPT_TEXT_TAG} tag`,
      );
    return { name, alias, version, template };
  }
}
