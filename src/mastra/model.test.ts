import { generateText } from 'ai';
import { describe, expect, test } from 'vitest';
import {
  createMockTaskModel,
  createTaskModel,
  DEFAULT_MOCK_REPLY,
  embeddingModel,
  MOCK_TASK_MODEL_ID,
  modelModeFrom,
  taskModel,
  MAX_MOCK_LATENCY_MS,
  mockLatencyFrom,
} from './model.js';

describe('model mode', () => {
  test('mock only when MODEL_MODE=mock', () => {
    expect(modelModeFrom({ MODEL_MODE: 'mock' })).toBe('mock');
    expect(modelModeFrom({ MODEL_MODE: 'live' })).toBe('live');
    expect(modelModeFrom({})).toBe('live');
  });
});

describe('mock task model', () => {
  test('answers with the canned reply and counts tokens from the prompt', async () => {
    const result = await generateText({
      model: createMockTaskModel(),
      system: 'Extract a profile.',
      prompt: 'Eleven years of React and design systems.',
    });
    expect(JSON.parse(result.text)).toMatchObject({ seniority: 'medior', avoid: [] });
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.response.modelId).toBe(MOCK_TASK_MODEL_ID);
  });

  test('a custom reply sees the prompt text', async () => {
    const model = createMockTaskModel((prompt) => `echo:${JSON.stringify(prompt.at(-1)?.content)}`);
    const result = await generateText({ model, prompt: 'hello' });
    expect(result.text).toBe('echo:[{"type":"text","text":"hello"}]');
    expect(DEFAULT_MOCK_REPLY([])).toContain('"role"');
  });
});

describe('createTaskModel', () => {
  test('mock mode ignores proxy settings; live mode needs key and base URL', () => {
    expect(createTaskModel({ MODEL_MODE: 'mock' }).modelId).toBe(MOCK_TASK_MODEL_ID);
    expect(() => createTaskModel({ MODEL_MODE: 'live', PROXY_BASE_URL: 'x' })).toThrow(
      'PROXY_API_KEY',
    );
    expect(() => createTaskModel({ MODEL_MODE: 'live', PROXY_API_KEY: 'k' })).toThrow(
      'PROXY_BASE_URL',
    );
    const live = createTaskModel({
      MODEL_MODE: 'live',
      PROXY_API_KEY: 'sk-card',
      PROXY_BASE_URL: 'https://ws.test/proxy/v1',
    });
    expect(live.modelId).toBe('talk-picker-task');
    expect(live.provider).toContain('talk-picker-proxy');
    expect(live.specificationVersion).toBe('v4');
  });

  test('process-wide accessors follow the test environment (MODEL_MODE=mock)', () => {
    expect(taskModel()).toBe(taskModel());
    expect(taskModel().modelId).toBe(MOCK_TASK_MODEL_ID);
    expect(embeddingModel().specificationVersion).toBe('v4');
  });
});

describe('mockLatencyFrom', () => {
  test('reads MOCK_LATENCY_MS, ignores junk and caps the value', () => {
    expect(mockLatencyFrom({})).toBe(0);
    expect(mockLatencyFrom({ MOCK_LATENCY_MS: 'abc' })).toBe(0);
    expect(mockLatencyFrom({ MOCK_LATENCY_MS: '-5' })).toBe(0);
    expect(mockLatencyFrom({ MOCK_LATENCY_MS: '800' })).toBe(800);
    expect(mockLatencyFrom({ MOCK_LATENCY_MS: '999999' })).toBe(MAX_MOCK_LATENCY_MS);
  });

  test('a mock task model with latency waits before it answers', async () => {
    const model = createTaskModel({ MODEL_MODE: 'mock', MOCK_LATENCY_MS: '30' });
    const started = Date.now();
    await generateText({ model, prompt: 'hello' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});
