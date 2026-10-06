import type { z } from 'zod';
import { nextStepFor, shortCause } from './unreachable.js';

/**
 * The one HTTP client for the workshop backend. Every participant route is
 * authenticated with the proxy key (the only secret on the card); the
 * backend maps its hash to the pseudonym. Timeouts are short so a dead
 * backend fails a script in seconds, with a message that says what to do.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BackendConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly fetchImpl: FetchLike;
}

export interface BackendRequest<T> {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  /** Validates the JSON the backend returns; a mismatch is a BackendError with status 0. */
  readonly schema?: z.ZodType<T>;
}

export const DEFAULT_BACKEND_TIMEOUT_MS = 3_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY = 429;
const BODY_PREVIEW = 200;

export class BackendError extends Error {
  constructor(
    readonly status: number,
    readonly route: string,
    detail: string,
  ) {
    super(`backend ${route} -> ${status}: ${detail}`);
    this.name = 'BackendError';
  }
}

export class BackendUnreachableError extends Error {
  constructor(
    /** The full URL that failed, host included. */
    readonly url: string,
    /** A short cause ("host not found", "TLS handshake failed"), never the raw socket reason. */
    readonly reason: string,
    /** What the participant does next; depends on the running script. */
    readonly nextStep: string = nextStepFor(process.env.npm_lifecycle_event),
  ) {
    super(`backend unreachable at ${url} (${reason}); ${nextStep}`);
    this.name = 'BackendUnreachableError';
  }
}

/** Reads WORKSHOP_BACKEND_URL and PROXY_API_KEY; the errors name the fix. */
export const backendConfigFrom = (
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly fetchImpl?: FetchLike; readonly timeoutMs?: number } = {},
): BackendConfig => {
  const baseUrl = env.WORKSHOP_BACKEND_URL?.trim();
  const apiKey = env.PROXY_API_KEY?.trim();
  if (!baseUrl) throw new Error('WORKSHOP_BACKEND_URL is empty; copy .env.example to .env');
  if (!apiKey) throw new Error('PROXY_API_KEY is empty; paste the key from your card into .env');
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    timeoutMs: options.timeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS,
    fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
  };
};

const errorDetail = (status: number, text: string): string => {
  const fromBody = (() => {
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      return typeof parsed.error === 'string' ? parsed.error : undefined;
    } catch {
      return undefined;
    }
  })();
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN)
    return `${fromBody ?? 'rejected'}; wrong or revoked key, re-paste PROXY_API_KEY in .env`;
  if (status === HTTP_TOO_MANY) return `${fromBody ?? 'rate limited'}; wait 10 seconds`;
  if (status === HTTP_CONFLICT) return fromBody ?? 'conflict';
  return fromBody ?? text.slice(0, BODY_PREVIEW);
};

const parseJson = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text;
  }
};

/** One request to a participant route; throws BackendError or BackendUnreachableError. */
export const backendRequest = async <T = unknown>(
  config: BackendConfig,
  route: string,
  request: BackendRequest<T> = {},
): Promise<T> => {
  const response = await config
    .fetchImpl(`${config.baseUrl}${route}`, {
      method: request.method ?? 'GET',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    .catch((error: unknown) => {
      throw new BackendUnreachableError(
        `${config.baseUrl}${route}`,
        shortCause(error, config.timeoutMs),
      );
    });
  const text = await response.text();
  if (!response.ok)
    throw new BackendError(response.status, route, errorDetail(response.status, text));
  const json = parseJson(text);
  if (!request.schema) return json as T;
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BackendError(
      0,
      route,
      `unexpected response shape at ${first?.path.join('.') || '<root>'}: ${first?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
};
