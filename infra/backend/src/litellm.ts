import type { FetchLike } from './mlflow.js';

/**
 * LiteLLM admin API for virtual keys. Field names per the LiteLLM proxy docs
 * (virtual keys) on 26 Sep 2026; confirm on the running v1.102.1 at the D-1
 * spike, this package is not installable here.
 */
export interface LitellmOptions {
  readonly baseUrl: string;
  readonly masterKey: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

export interface GenerateKeyInput {
  readonly alias: string;
  readonly maxBudgetUsd: number;
  readonly rpmLimit: number;
  readonly models: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 8_000;
export const PARTICIPANT_MODELS = ['talk-picker-task', 'talk-picker-embed'] as const;

export class LitellmClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(private readonly options: LitellmOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async post<T>(route: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.masterKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`litellm ${route} -> ${response.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health/liveliness`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateKey(input: GenerateKeyInput): Promise<string> {
    const result = await this.post<{ key?: string }>('/key/generate', {
      key_alias: input.alias,
      max_budget: input.maxBudgetUsd,
      rpm_limit: input.rpmLimit,
      models: [...input.models],
      metadata: { participant: input.alias, workshop: 'frontmania-2026' },
    });
    if (!result.key) throw new Error('litellm /key/generate returned no key');
    return result.key;
  }

  async deleteKeysByAlias(aliases: readonly string[]): Promise<void> {
    if (aliases.length === 0) return;
    await this.post('/key/delete', { key_aliases: [...aliases] });
  }
}
