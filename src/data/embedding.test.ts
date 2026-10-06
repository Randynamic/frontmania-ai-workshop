import { describe, expect, test } from 'vitest';
import { embedMany } from 'ai';
import {
  createEmbeddingModel,
  createLiveEmbeddingModel,
  createMockEmbeddingModel,
  embeddingModeFrom,
  hashEmbedding,
  MOCK_EMBEDDING_DIMENSION,
  MOCK_EMBEDDING_ID,
  tokenize,
} from './embedding.js';

const dot = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

describe('hashEmbedding', () => {
  test('is deterministic, unit length and of the requested dimension', () => {
    // Act
    const first = hashEmbedding('Container queries in production', 128);
    const second = hashEmbedding('Container queries in production', 128);

    // Assert
    expect(first).toEqual(second);
    expect(first).toHaveLength(128);
    expect(dot(first, first)).toBeCloseTo(1, 6);
  });

  test('ranks lexically similar text closer than unrelated text', () => {
    // Arrange
    const query = hashEmbedding('accessibility screen reader forms');
    const related = hashEmbedding('Forms people can finish: accessibility with a screen reader');
    const unrelated = hashEmbedding('Kubernetes cluster networking and pod scheduling');

    // Assert
    expect(dot(query, related)).toBeGreaterThan(dot(query, unrelated));
  });

  test('returns a unit vector for empty text and rejects a bad dimension', () => {
    expect(dot(hashEmbedding(''), hashEmbedding(''))).toBeCloseTo(1, 6);
    expect(() => hashEmbedding('x', 0)).toThrow(/dimension/);
  });

  test('tokenize lowercases, keeps c#, c++ and dotted names, drops single characters', () => {
    expect(tokenize('Next.js and C# vs C++, a B')).toEqual(['next.js', 'and', 'c#', 'vs', 'c++']);
  });
});

describe('createMockEmbeddingModel', () => {
  test('works with embedMany and reports token usage', async () => {
    // Arrange
    const model = createMockEmbeddingModel(32);

    // Act
    const result = await embedMany({ model, values: ['one two', 'three'] });

    // Assert
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(32);
    expect(result.usage.tokens).toBe(3);
    expect(model.modelId).toBe(MOCK_EMBEDDING_ID);
  });
});

describe('createEmbeddingModel', () => {
  test('picks mock from MODEL_MODE and defaults to live', () => {
    expect(embeddingModeFrom({ MODEL_MODE: 'mock' })).toBe('mock');
    expect(embeddingModeFrom({})).toBe('live');
    expect(createEmbeddingModel({ MODEL_MODE: 'mock' }).modelId).toBe(MOCK_EMBEDDING_ID);
  });

  test('builds the proxy model from env without a network call', () => {
    const model = createEmbeddingModel({
      PROXY_BASE_URL: 'http://localhost:8080/proxy/v1',
      PROXY_API_KEY: 'sk-test',
    });
    expect(model.modelId).toBe('talk-picker-embed');
    expect(model.specificationVersion).toBe('v4');
  });

  test('fails fast with a fix when the key or url is missing', () => {
    expect(() => createLiveEmbeddingModel({ baseURL: 'x', apiKey: '', modelId: 'm' })).toThrow(
      /card/,
    );
    expect(() => createLiveEmbeddingModel({ baseURL: '', apiKey: 'k', modelId: 'm' })).toThrow(
      /\.env/,
    );
  });

  test('mock dimension defaults to the shared constant', async () => {
    const result = await embedMany({
      model: createEmbeddingModel({ MODEL_MODE: 'mock' }),
      values: ['a b'],
    });
    expect(result.embeddings[0]).toHaveLength(MOCK_EMBEDDING_DIMENSION);
  });
});
