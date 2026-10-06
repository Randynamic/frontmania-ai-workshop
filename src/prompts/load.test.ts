import { describe, expect, test } from 'vitest';
import { backendConfigFrom } from '../backend/client.js';
import { clearPromptCache, createPromptLoader, PROMPT_CACHE_TTL_MS } from './load.js';

const registry = (calls: string[], template = 'Rank {{talks}} for {{profile}}') =>
  backendConfigFrom(
    { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
    {
      fetchImpl: async (url) => {
        calls.push(url);
        const name = url.split('/').at(-1) ?? '';
        if (name === 'tip')
          return new Response('{"error":"no version for tip@production"}', { status: 404 });
        return new Response(JSON.stringify({ name, alias: 'production', version: '4', template }), {
          status: 200,
        });
      },
    },
  );

describe('prompt loader', () => {
  test('fetches by name and caches for the ttl', async () => {
    const calls: string[] = [];
    const clock = { now: 1_000 };
    const loader = createPromptLoader({ config: registry(calls), now: () => clock.now });
    const first = await loader.load('ranker');
    expect(first).toEqual({
      name: 'ranker',
      alias: 'production',
      version: '4',
      template: 'Rank {{talks}} for {{profile}}',
    });
    await loader.load('ranker');
    expect(calls).toEqual(['https://ws.test/api/prompts/ranker']);
    clock.now += PROMPT_CACHE_TTL_MS + 1;
    await loader.load('ranker');
    expect(calls).toHaveLength(2);
    await loader.load('profile');
    expect(calls).toHaveLength(3);
    loader.clear();
    await loader.load('ranker');
    expect(calls).toHaveLength(4);
  });

  test('surfaces a missing alias and a bad shape as backend errors', async () => {
    const loader = createPromptLoader({ config: registry([]) });
    await expect(loader.load('tip')).rejects.toThrow('no version for tip@production');
    const broken = createPromptLoader({ config: registry([], '') });
    await expect(broken.load('ranker')).rejects.toThrow('unexpected response shape at template');
  });

  test('the default loader can be cleared', () => {
    expect(() => clearPromptCache()).not.toThrow();
  });
});
