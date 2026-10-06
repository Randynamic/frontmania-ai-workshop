import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { MockEmbeddingModelV4 } from 'ai/test';
import type { EmbeddingModel } from 'ai';

/** The provider-v4 embedding model shape, taken from `ai`'s own union so no transitive package is imported. */
export type EmbeddingModelV4 = Extract<EmbeddingModel, { specificationVersion: 'v4' }>;

/**
 * Embedding models for the archive index.
 *
 * live: the proxy's `talk-picker-embed` alias through @ai-sdk/openai-compatible.
 * mock: a deterministic feature-hashing embedding (bag of words, signed
 * hashing trick, L2-normalised). It needs no network, returns the same vector
 * for the same text, and gives real lexical similarity, so LibSQL returns
 * sensible archive rows in CI and in `MODEL_MODE=mock`.
 */

export const MOCK_EMBEDDING_DIMENSION = 256;
export const MOCK_EMBEDDING_ID = 'mock-hash-v1';
const MIN_TOKEN_LENGTH = 2;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SIGN_BIT = 0x80000000;

const fnv1a = (text: string): number => {
  let hash = FNV_OFFSET;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
};

export const tokenize = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .map((token) => token.replace(/^[.]+|[.]+$/g, ''))
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);

const l2Normalise = (vector: readonly number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector.map((_, i) => (i === 0 ? 1 : 0));
  return vector.map((v) => v / norm);
};

/** Deterministic embedding of `text` into `dimension` floats. */
export const hashEmbedding = (text: string, dimension = MOCK_EMBEDDING_DIMENSION): number[] => {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error(`hashEmbedding: dimension must be a positive integer, got ${dimension}`);
  }
  const counts = tokenize(text).reduce<Map<number, number>>((acc, token) => {
    const hash = fnv1a(token);
    const index = hash % dimension;
    const sign = (hash & SIGN_BIT) === 0 ? 1 : -1;
    return new Map(acc).set(index, (acc.get(index) ?? 0) + sign);
  }, new Map());
  const raw = Array.from({ length: dimension }, (_, i) => counts.get(i) ?? 0);
  return l2Normalise(raw);
};

export const createMockEmbeddingModel = (dimension = MOCK_EMBEDDING_DIMENSION): EmbeddingModelV4 =>
  new MockEmbeddingModelV4({
    provider: 'talk-picker-mock',
    modelId: MOCK_EMBEDDING_ID,
    maxEmbeddingsPerCall: null,
    supportsParallelCalls: true,
    doEmbed: async ({ values }) => ({
      embeddings: values.map((value) => hashEmbedding(value, dimension)),
      usage: { tokens: values.reduce((sum, value) => sum + tokenize(value).length, 0) },
      warnings: [],
    }),
  });

export interface LiveEmbeddingConfig {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly modelId: string;
}

export const createLiveEmbeddingModel = (config: LiveEmbeddingConfig): EmbeddingModelV4 => {
  if (!config.apiKey) throw new Error('PROXY_API_KEY is empty; paste the key from your card');
  if (!config.baseURL) throw new Error('PROXY_BASE_URL is empty; copy .env.example to .env');
  return createOpenAICompatible({
    name: 'talk-picker-proxy',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  }).embeddingModel(config.modelId);
};

export type EmbeddingMode = 'live' | 'mock';

export const embeddingModeFrom = (
  env: Readonly<Record<string, string | undefined>>,
): EmbeddingMode => (env.MODEL_MODE === 'mock' ? 'mock' : 'live');

/** The embedding model for the current MODEL_MODE; mock vectors match `dimension`. */
export const createEmbeddingModel = (
  env: Readonly<Record<string, string | undefined>>,
  dimension: number = MOCK_EMBEDDING_DIMENSION,
): EmbeddingModelV4 =>
  embeddingModeFrom(env) === 'mock'
    ? createMockEmbeddingModel(dimension)
    : createLiveEmbeddingModel({
        baseURL: env.PROXY_BASE_URL ?? '',
        apiKey: env.PROXY_API_KEY ?? '',
        modelId: env.EMBED_MODEL ?? 'talk-picker-embed',
      });
