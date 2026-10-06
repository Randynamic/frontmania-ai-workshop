import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { RawTrace } from './mlflow.js';
import {
  decodeOtlpValue,
  flattenAttributes,
  spanTokens,
  toSpanView,
  toTraceView,
} from './trace-view.js';

/** Observed 26 Sep 2026: GET /api/3.0/mlflow/traces/get on MLflow 3.16.1, one Mastra 1.71.0 trace. */
const REAL_TRACE = (
  JSON.parse(
    readFileSync(new URL('./fixtures/mlflow-3.16.1-trace.json', import.meta.url), 'utf8'),
  ) as { trace: RawTrace }
).trace;

describe('trace-view against the observed 3.16.1 shape', () => {
  test('decodes nested kvlist and array values', () => {
    expect(
      decodeOtlpValue({
        kvlist_value: {
          values: [
            { key: 'total_tokens', value: { int_value: '341' } },
            { key: 'parts', value: { array_value: { values: [{ string_value: 'a' }] } } },
            { key: 'ok', value: { bool_value: true } },
          ],
        },
      }),
    ).toEqual({ total_tokens: 341, parts: ['a'], ok: true });
    expect(decodeOtlpValue(undefined)).toBeUndefined();
    expect(decodeOtlpValue({})).toBeUndefined();
  });

  test('flattens OTLP attribute arrays and plain records', () => {
    const flat = flattenAttributes([
      { key: 'mlflow.spanInputs', value: { string_value: '{"messages":[{"role":"user"}]}' } },
      { key: 'gen_ai.usage.total_tokens', value: { intValue: '17' } },
      { key: 'plain', value: { stringValue: 'text' } },
      { value: { string_value: 'dropped: no key' } },
    ]);
    expect(flat['mlflow.spanInputs']).toEqual({ messages: [{ role: 'user' }] });
    expect(flat['gen_ai.usage.total_tokens']).toBe(17);
    expect(flat['plain']).toBe('text');
    expect(flattenAttributes({ a: '{"b":1}' })).toEqual({ a: { b: 1 } });
    expect(flattenAttributes(undefined)).toEqual({});
  });

  test('reads the real trace: id, tokens, latency, five spans, masked input, assessments', () => {
    const view = toTraceView('tr-446ae47eb395812155265a4e51014e75', REAL_TRACE);
    expect(view.found).toBe(true);
    expect(view.tokens).toBe(341);
    expect(view.latencyMs).toBe(56);
    expect(view.spans.map((s) => s.name)).toEqual([
      'invoke_agent profile',
      'model_generation mock-task',
      'agent_step profile',
      'chat mock-task',
      'model_chunk profile',
    ]);
    const root = view.spans[0];
    expect(root?.input).toBe('[cv:sha256:dacb693fe21b]\n');
    expect(root?.output).toMatchObject({ text: expect.stringContaining('Senior Front-end') });
    expect(root?.attributes['mastra.metadata.participantId']).toBe('otter-42');
    const chat = view.spans[3];
    expect(chat?.attributes['mlflow.chat.tokenUsage']).toEqual({
      input_tokens: 321,
      output_tokens: 20,
      total_tokens: 341,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(spanTokens(chat?.attributes ?? {})).toBe(341);
    expect(view.assessments).toHaveLength(2);
    expect(view.assessments[0]).toMatchObject({
      assessment_name: 'slot_pick',
      source: { source_type: 'HUMAN', source_id: 'otter-42' },
      feedback: { value: 'up' },
      metadata: { slot: '14:15' },
    });
    expect(JSON.stringify(view)).not.toContain('Femke');
  });

  test('falls back to per-span totals or input + output when the trace has no usage metadata', () => {
    const view = toTraceView('tr-1', {
      trace_info: {},
      spans: [
        {
          name: 'plan',
          start_time_unix_nano: '1000000000',
          end_time_unix_nano: '5000000000',
          attributes: [],
        },
        {
          name: 'rankSlot',
          startTimeUnixNano: '2000000000',
          endTimeUnixNano: '3000000000',
          attributes: [{ key: 'llm.token_count.total', value: { int_value: 10 } }],
        },
        {
          name: 'chat',
          start_time_unix_nano: '2000000000',
          end_time_unix_nano: '3500000000',
          attributes: [
            { key: 'gen_ai.usage.input_tokens', value: { int_value: 8 } },
            { key: 'gen_ai.usage.output_tokens', value: { int_value: 4 } },
          ],
        },
      ],
    });
    expect(view.tokens).toBe(22);
    expect(view.latencyMs).toBe(4000);
    expect(spanTokens({})).toBeNull();
  });

  test('empty trace yields nulls, not NaN', () => {
    expect(toTraceView('tr-0', {})).toMatchObject({
      found: true,
      tokens: null,
      latencyMs: null,
      spans: [],
      assessments: [],
    });
  });
});

describe('span view wire shape', () => {
  // Observed 26 Sep 2026 in the local rehearsal: processor spans carry no
  // input/output attribute; JSON dropped the undefined keys and the
  // participant-side zod 4 schema (`input: z.unknown()`) rejected the whole
  // trace, so every live check:NN failed on "trace found at the backend".
  test('a span without input or output keeps both keys as null after JSON', () => {
    const view = toSpanView({ name: 'processor', attributes: [] });
    const wire = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
    expect(wire).toHaveProperty('input', null);
    expect(wire).toHaveProperty('output', null);
  });
});
