import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { embeddingModelForArchive } from '../data/archive.js';
import type { EmbeddingModelV4 } from '../data/embedding.js';
import { plannerMockContent, type MockContent } from './mock-planner.js';
import { promptText, routedMockReply } from './mock-replies.js';

/**
 * Models for the agents and steps.
 *
 * live: the proxy's `talk-picker-task` alias through @ai-sdk/openai-compatible
 *   (provider spec v4, which Mastra 1.71 accepts as MastraModelConfig).
 * mock: `MockLanguageModelV4` from ai/test with a canned reply, so every unit
 *   test and every `check:NN --static` runs offline. The reply function sees
 *   the prompt; the default one (src/mastra/mock-replies.ts) answers a
 *   profile, a ranking or a tip depending on what the prompt asks for. When
 *   the agent offers tools (the planner, exercise 3) the scripted tool loop
 *   in src/mastra/mock-planner.ts answers instead, with `tool-call` content
 *   parts (@ai-sdk/provider LanguageModelV4ToolCall: toolCallId, toolName,
 *   input as JSON text).
 */
export type LanguageModelV4 = Extract<LanguageModel, { specificationVersion: 'v4' }>;
export type ModelMode = 'live' | 'mock';

type CallOptions = Parameters<LanguageModelV4['doGenerate']>[0];
export type MockPrompt = CallOptions['prompt'];
export type MockReply = (prompt: MockPrompt) => string;

export const MOCK_TASK_MODEL_ID = 'mock-task-v1';
export const DEFAULT_TASK_MODEL = 'talk-picker-task';

/** Profile for a CV prompt, ranking or tip for the registry prompts; every structured output validates. */
export const DEFAULT_MOCK_REPLY: MockReply = routedMockReply;

export const modelModeFrom = (env: Readonly<Record<string, string | undefined>>): ModelMode =>
  env.MODEL_MODE === 'mock' ? 'mock' : 'live';

const approximateTokens = (text: string): number => text.split(/\s+/).filter(Boolean).length;

export interface MockModelOptions {
  /** Simulated model latency per call; tests use it to prove the fan-out runs in parallel. */
  readonly delayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export const createMockTaskModel = (
  reply: MockReply = DEFAULT_MOCK_REPLY,
  options: MockModelOptions = {},
): LanguageModelV4 =>
  new MockLanguageModelV4({
    provider: 'talk-picker-mock',
    modelId: MOCK_TASK_MODEL_ID,
    doGenerate: async ({ prompt, tools }) => {
      if (options.delayMs) await sleep(options.delayMs);
      const toolNames = (tools ?? []).flatMap((tool) =>
        tool.type === 'function' ? [tool.name] : [],
      );
      // A tool-using agent (the planner) gets the scripted tool loop; every
      // other call keeps the prompt-routed text reply.
      const content: MockContent =
        toolNames.length > 0
          ? plannerMockContent(prompt, toolNames)
          : [{ type: 'text', text: reply(prompt) }];
      const hasToolCall = content.some((part) => part.type === 'tool-call');
      const text = content.map((part) => (part.type === 'text' ? part.text : '')).join(' ');
      const inputTokens = approximateTokens(promptText(prompt));
      const outputTokens = approximateTokens(text) + (hasToolCall ? content.length : 0);
      return {
        content,
        finishReason: hasToolCall
          ? { unified: 'tool-calls', raw: 'tool_calls' }
          : { unified: 'stop', raw: 'stop' },
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

/** Upper bound for MOCK_LATENCY_MS, so a typo cannot stall a check. */
export const MAX_MOCK_LATENCY_MS = 5_000;

/**
 * MOCK_LATENCY_MS: optional simulated latency per mock model call, so the
 * step 2 speed-up (concurrency 3 versus 1) shows offline in `pnpm plan`.
 * Unset, empty or invalid means 0; values are capped at MAX_MOCK_LATENCY_MS.
 */
export const mockLatencyFrom = (env: Readonly<Record<string, string | undefined>>): number => {
  const value = Number(env.MOCK_LATENCY_MS ?? '');
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), MAX_MOCK_LATENCY_MS);
};

/** The task model for MODEL_MODE; `mockReply` only matters in mock mode. */
export const createTaskModel = (
  env: Readonly<Record<string, string | undefined>>,
  mockReply: MockReply = DEFAULT_MOCK_REPLY,
): LanguageModelV4 =>
  modelModeFrom(env) === 'mock'
    ? createMockTaskModel(mockReply, { delayMs: mockLatencyFrom(env) })
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
