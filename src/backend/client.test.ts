import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  backendConfigFrom,
  BackendError,
  backendRequest,
  BackendUnreachableError,
  DEFAULT_BACKEND_TIMEOUT_MS,
  type FetchLike,
} from './client.js';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

const configWith = (fetchImpl: FetchLike, calls: Call[] = []) =>
  backendConfigFrom(
    { WORKSHOP_BACKEND_URL: 'https://ws.test/', PROXY_API_KEY: 'sk-card' },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return fetchImpl(url, init);
      },
    },
  );

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('backendConfigFrom', () => {
  test('strips the trailing slash and names the missing variable', () => {
    const config = backendConfigFrom({
      WORKSHOP_BACKEND_URL: 'https://ws.test/',
      PROXY_API_KEY: 'k',
    });
    expect(config.baseUrl).toBe('https://ws.test');
    expect(config.timeoutMs).toBe(DEFAULT_BACKEND_TIMEOUT_MS);
    expect(() => backendConfigFrom({ PROXY_API_KEY: 'k' })).toThrow('WORKSHOP_BACKEND_URL');
    expect(() => backendConfigFrom({ WORKSHOP_BACKEND_URL: 'x' })).toThrow('your card');
  });
});

describe('backendRequest', () => {
  test('sends the bearer key, JSON body and validates the response', async () => {
    const calls: Call[] = [];
    const config = configWith(async () => json(200, { ok: true, id: '7' }), calls);
    const result = await backendRequest(config, '/api/runs', {
      method: 'POST',
      body: { traceId: 'tr-1', kind: 'plan' },
      schema: z.object({ ok: z.literal(true), id: z.string() }),
    });
    expect(result).toEqual({ ok: true, id: '7' });
    expect(calls[0]?.url).toBe('https://ws.test/api/runs');
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer sk-card', 'content-type': 'application/json' },
      body: '{"traceId":"tr-1","kind":"plan"}',
    });
  });

  test('GET without body has no content-type and returns raw JSON without a schema', async () => {
    const calls: Call[] = [];
    const config = configWith(async () => json(200, { participantId: 'otter-42' }), calls);
    expect(await backendRequest(config, '/api/whoami')).toEqual({ participantId: 'otter-42' });
    expect((calls[0]?.init?.headers as Record<string, string>)['content-type']).toBeUndefined();
    const empty = configWith(async () => new Response('', { status: 200 }));
    expect(await backendRequest(empty, '/api/auth')).toEqual({});
  });

  test('explains 401, 429, 409 and other errors with the backend message', async () => {
    const unauthorized = configWith(async () => json(401, { error: 'key revoked' }));
    await expect(backendRequest(unauthorized, '/api/whoami')).rejects.toThrow(
      'key revoked; wrong or revoked key, re-paste PROXY_API_KEY',
    );
    const limited = configWith(async () => json(429, { error: 'slow down' }));
    await expect(backendRequest(limited, '/api/x')).rejects.toThrow('wait 10 seconds');
    const conflict = configWith(async () => json(409, { error: 'key not linked' }));
    await expect(backendRequest(conflict, '/api/x')).rejects.toMatchObject({
      status: 409,
      message: 'backend /api/x -> 409: key not linked',
    });
    const plain = configWith(async () => new Response('boom', { status: 500 }));
    const error = await backendRequest(plain, '/api/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect((error as BackendError).message).toContain('500: boom');
  });

  test('a wrong response shape is a BackendError with status 0', async () => {
    const config = configWith(async () => json(200, { nope: 1 }));
    await expect(
      backendRequest(config, '/api/prompts/ranker', { schema: z.object({ template: z.string() }) }),
    ).rejects.toThrow('unexpected response shape at template');
  });

  test('network failures become BackendUnreachableError with the full URL, a short cause and a next step', async () => {
    // Arrange: what Node's fetch throws on a TLS handshake against a plain-HTTP port
    const tlsFailure = Object.assign(
      new Error(
        'write EPROTO 00F8:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:../deps/openssl/ssl/record/ssl3_record.c:354:',
      ),
      { code: 'EPROTO' },
    );
    const config = configWith(async () => {
      throw new TypeError('fetch failed', { cause: tlsFailure });
    });

    // Act
    const error = await backendRequest(config, '/api/health').catch((e: unknown) => e);

    // Assert
    expect(error).toBeInstanceOf(BackendUnreachableError);
    const unreachable = error as BackendUnreachableError;
    expect(unreachable.url).toBe('https://ws.test/api/health');
    expect(unreachable.reason).toBe('TLS handshake failed');
    expect(unreachable.message).toContain('backend unreachable at https://ws.test/api/health');
    expect(unreachable.message).not.toContain('ssl3_get_record');
    expect(unreachable.message).toContain('tell the floater');
  });

  test('a refused connection keeps its short name', async () => {
    const config = configWith(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), {
          code: 'ECONNREFUSED',
        }),
      });
    });
    const error = await backendRequest(config, '/api/health').catch((e: unknown) => e);
    expect((error as BackendUnreachableError).reason).toBe('connection refused');
  });
});
