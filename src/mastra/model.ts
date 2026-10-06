import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { embeddingModelForArchive } from '../data/archive.js';
import type { EmbeddingModelV4 } from '../data/embedding.js';

/**
 * Models for the agents and steps.
 *
 * live: the proxy's `talk-picker-task` alias through @ai-sdk/openai-compatible
 *   (provider spec v4, which Mastra 1.71 accepts as MastraModelConfig).
 * mock: `MockLanguageModelV4` from ai/test with a canned reply, so every unit
 *   test and every `check:NN --static` runs offline. The reply function sees
 *   the prompt, so later branches can answer per agent.
 */
export type LanguageModelV4 = Extract<LanguageModel, { specificationVersion: 'v4' }>;
export type ModelMode = 'live' | 'mock';

type CallOptions = Parameters<LanguageModelV4['doGenerate']>[0];
export type MockPrompt = CallOptions['prompt'];
export type MockReply = (prompt: MockPrompt) => string;

export const MOCK_TASK_MODEL_ID = 'mock-task-v1';
export const DEFAULT_TASK_MODEL = 'talk-picker-task';

/** A profile-shaped answer: the first exercise's structured output validates against it. */
export const DEFAULT_MOCK_REPLY: MockReply = () =>
  JSON.stringify({
    role: 'front-end developer',
    seniority: 'medior',
    stack: ['typescript', 'react'],
    interests: ['accessibility', 'performance'],
    avoid: [],
  });

export const modelModeFrom = (env: Readonly<Record<string, string | undefined>>): ModelMode =>
  env.MODEL_MODE === 'mock' ? 'mock' : 'live';

const promptText = (prompt: MockPrompt): string =>
  prompt
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content
            .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
            .join(' '),
    )
    .join('\n');

const approximateTokens = (text: string): number => text.split(/\s+/).filter(Boolean).length;

export const createMockTaskModel = (reply: MockReply = DEFAULT_MOCK_REPLY): LanguageModelV4 =>
  new MockLanguageModelV4({
    provider: 'talk-picker-mock',
    modelId: MOCK_TASK_MODEL_ID,
    doGenerate: async ({ prompt }) => {
      const text = reply(prompt);
      const inputTokens = approximateTokens(promptText(prompt));
      const outputTokens = approximateTokens(text);
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });

export interface LiveModelConfig {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly modelId: string;
}

export const createLiveTaskModel = (config: LiveModelConfig): LanguageModelV4 => {
  if (!config.apiKey) throw new Error('PROXY_API_KEY is empty; paste the key from your card');
  if (!config.baseURL) throw new Error('PROXY_BASE_URL is empty; copy .env.example to .env');
  return createOpenAICompatible({
    name: 'talk-picker-proxy',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    // Send the Zod schema as response_format json_schema; without it the provider sends only
    // json_object and Gemini (Vertex, behind LiteLLM) invents its own field names.
    // Verified 6 Oct 2026 against @ai-sdk/openai-compatible 3.0.57 (dist/index.d.ts).
    supportsStructuredOutputs: true,
  }).chatModel(config.modelId);
};

/** The task model for MODEL_MODE; `mockReply` only matters in mock mode. */
export const createTaskModel = (
  env: Readonly<Record<string, string | undefined>>,
  mockReply: MockReply = DEFAULT_MOCK_REPLY,
): LanguageModelV4 =>
  modelModeFrom(env) === 'mock'
    ? createMockTaskModel(mockReply)
    : createLiveTaskModel({
        baseURL: env.PROXY_BASE_URL ?? '',
        apiKey: env.PROXY_API_KEY ?? '',
        modelId: env.TASK_MODEL ?? DEFAULT_TASK_MODEL,
      });

let cachedTaskModel: LanguageModelV4 | undefined;
/** Process-wide task model from process.env, created on first use. */
export const taskModel = (): LanguageModelV4 => {
  cachedTaskModel ??= createTaskModel(process.env);
  return cachedTaskModel;
};

/** The embedding model that matches the committed archive index. */
export const embeddingModel = (): EmbeddingModelV4 => embeddingModelForArchive(process.env);
