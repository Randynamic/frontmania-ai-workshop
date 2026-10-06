import { describe, expect, test } from 'vitest';
import { MlflowClient, MlflowError } from './mlflow.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const clientWith = (handler: (call: Call) => { status: number; body?: unknown }) => {
  const calls: Call[] = [];
  const client = new MlflowClient({
    baseUrl: 'http://mlflow:5000/',
    experimentId: '7',
    fetchImpl: async (url, init) => {
      const call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const { status, body } = handler(call);
      return new Response(body === undefined ? '' : JSON.stringify(body), { status });
    },
  });
  return { client, calls };
};

describe('MlflowClient', () => {
  test('getTrace uses GET /api/3.0/mlflow/traces/get and maps 404 to undefined', async () => {
    const { client, calls } = clientWith(({ url }) =>
      url.includes('tr-1')
        ? { status: 200, body: { trace: { spans: [] } } }
        : { status: 404, body: {} },
    );
    expect(await client.getTrace('tr-1')).toEqual({ spans: [] });
    expect(calls[0]).toMatchObject({
      url: 'http://mlflow:5000/api/3.0/mlflow/traces/get?trace_id=tr-1',
      method: 'GET',
    });
    expect(await client.getTrace('tr-2')).toBeUndefined();
  });

  test('searchTraceIds posts the experiment location', async () => {
    const { client, calls } = clientWith(() => ({
      status: 200,
      body: { traces: [{ trace_id: 'tr-1' }, {}] },
    }));
    expect(await client.searchTraceIds()).toEqual(['tr-1']);
    expect(calls[0]?.body).toEqual({
      locations: [{ type: 'MLFLOW_EXPERIMENT', mlflow_experiment: { experiment_id: '7' } }],
      max_results: 500,
    });
  });

  test('deleteAllTraces loops until a batch deletes nothing', async () => {
    let remaining = 1200;
    const { client, calls } = clientWith(() => {
      const deleted = Math.min(500, remaining);
      remaining -= deleted;
      return { status: 200, body: { traces_deleted: deleted } };
    });
    expect(await client.deleteAllTraces(123)).toBe(1200);
    expect(calls).toHaveLength(4);
    expect(calls[0]?.body).toEqual({
      experiment_id: '7',
      max_timestamp_millis: 123,
      max_traces: 500,
    });
  });

  test('createAssessment builds the v3 body for feedback and expectation', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: {} }));
    await client.createAssessment({
      traceId: 'tr-1',
      name: 'slot_pick',
      sourceId: 'otter-42',
      feedback: 'up',
      rationale: 'r',
      metadata: { slot: '14:15' },
    });
    await client.createAssessment({
      traceId: 'tr-1',
      name: 'expected_pick',
      sourceId: 'otter-42',
      expectation: 't1',
    });
    expect(calls[0]?.url).toBe('http://mlflow:5000/api/3.0/mlflow/traces/tr-1/assessments');
    expect(calls[0]?.body).toEqual({
      assessment: {
        trace_id: 'tr-1',
        assessment_name: 'slot_pick',
        source: { source_type: 'HUMAN', source_id: 'otter-42' },
        feedback: { value: 'up' },
        rationale: 'r',
        metadata: { slot: '14:15' },
      },
    });
    expect(calls[1]?.body).toEqual({
      assessment: {
        trace_id: 'tr-1',
        assessment_name: 'expected_pick',
        source: { source_type: 'HUMAN', source_id: 'otter-42' },
        expectation: { value: 't1' },
      },
    });
  });

  test('getPromptByAlias reads the alias then the version tag', async () => {
    const { client, calls } = clientWith(({ url }) =>
      url.includes('registered-models/alias')
        ? { status: 200, body: { model_version: { version: '4' } } }
        : {
            status: 200,
            body: {
              model_version: { tags: [{ key: 'mlflow.prompt.text', value: 'Rank {{talks}}' }] },
            },
          },
    );
    expect(await client.getPromptByAlias('ranker', 'production')).toEqual({
      name: 'ranker',
      alias: 'production',
      version: '4',
      template: 'Rank {{talks}}',
    });
    expect(calls[0]?.url).toBe(
      'http://mlflow:5000/api/2.0/mlflow/registered-models/alias?name=ranker&alias=production',
    );
    expect(calls[1]?.url).toBe(
      'http://mlflow:5000/api/2.0/mlflow/model-versions/get?name=ranker&version=4',
    );
  });

  test('getPromptByVersion reads one version directly and labels the alias', async () => {
    const { client, calls } = clientWith(() => ({
      status: 200,
      body: { model_version: { tags: [{ key: 'mlflow.prompt.text', value: 'Pinned {{talks}}' }] } },
    }));
    expect(await client.getPromptByVersion('ranker', '2')).toEqual({
      name: 'ranker',
      alias: 'pinned',
      version: '2',
      template: 'Pinned {{talks}}',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'http://mlflow:5000/api/2.0/mlflow/model-versions/get?name=ranker&version=2',
    );
    const bare = clientWith(() => ({ status: 200, body: { model_version: { tags: [] } } }));
    await expect(bare.client.getPromptByVersion('ranker', '3')).rejects.toThrow(
      'mlflow.prompt.text',
    );
  });

  test('errors carry status and route; health swallows network errors', async () => {
    const { client } = clientWith(() => ({ status: 500, body: { message: 'boom' } }));
    await expect(client.searchTraceIds()).rejects.toBeInstanceOf(MlflowError);
    const broken = new MlflowClient({
      baseUrl: 'http://x',
      experimentId: '1',
      fetchImpl: async () => {
        throw new Error('down');
      },
    });
    expect(await broken.health()).toBe(false);
  });
});
