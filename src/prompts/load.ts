import { z } from 'zod';
import { backendConfigFrom, backendRequest, type BackendConfig } from '../backend/client.js';
import { modelModeFrom } from '../mastra/model.js';
import { seedPromptVersion } from './seed.js';

/**
 * Prompt text comes from the MLflow prompt registry through the backend
 * (GET /api/prompts/:name, alias `production`), so the reveal can move the
 * alias without a code change. A 30 s cache keeps one CLI run on one version.
 * In MODEL_MODE=mock the seed templates (src/prompts/seed.ts) stand in for
 * the registry, so unit tests and `check:NN --static` need no backend.
 */
export const PROMPT_NAMES = ['profile', 'ranker', 'tip'] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export const PromptVersion = z.object({
  name: z.enum(PROMPT_NAMES),
  alias: z.string().min(1),
  version: z.string().min(1),
  template: z.string().min(1),
});
export type PromptVersion = z.infer<typeof PromptVersion>;

export const PROMPT_CACHE_TTL_MS = 30_000;

export interface PromptLoaderOptions {
  readonly config?: BackendConfig;
  readonly ttlMs?: number;
  readonly now?: () => number;
  /** Where MODEL_MODE is read from; defaults to process.env at call time. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

interface CacheEntry {
  readonly value: PromptVersion;
  readonly expiresAt: number;
}

export interface PromptLoader {
  readonly load: (name: PromptName) => Promise<PromptVersion>;
  readonly clear: () => void;
}

export const createPromptLoader = (options: PromptLoaderOptions = {}): PromptLoader => {
  const ttlMs = options.ttlMs ?? PROMPT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  let cache: Readonly<Record<string, CacheEntry>> = {};
  return {
    load: async (name) => {
      if (modelModeFrom(options.env ?? process.env) === 'mock') return seedPromptVersion(name);
      const hit = cache[name];
      if (hit && hit.expiresAt > now()) return hit.value;
      const config = options.config ?? backendConfigFrom(process.env);
      const value = await backendRequest(config, `/api/prompts/${name}`, { schema: PromptVersion });
      cache = { ...cache, [name]: { value, expiresAt: now() + ttlMs } };
      return value;
    },
    clear: () => {
      cache = {};
    },
  };
};

const defaultLoader = createPromptLoader();

/** The production version of a registry prompt, cached for 30 s. */
export const loadPrompt = (name: PromptName): Promise<PromptVersion> => defaultLoader.load(name);

export const clearPromptCache = (): void => defaultLoader.clear();
