import { describe, expect, test } from 'vitest';
import { backendConfigFrom } from './client.js';
import { fetchParticipantId } from './whoami.js';

const configWith = (status: number, body: string) =>
  backendConfigFrom(
    { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
    { fetchImpl: async () => new Response(body, { status }) },
  );

describe('fetchParticipantId', () => {
  test('returns the pseudonym from a 200', async () => {
    await expect(
      fetchParticipantId(configWith(200, '{"ok":true,"participantId":"otter-42"}')),
    ).resolves.toBe('otter-42');
  });

  test('a 409 (page variant, id not registered) and a bad shape both throw with the route', async () => {
    await expect(fetchParticipantId(configWith(409, '{"error":"register first"}'))).rejects.toThrow(
      '/api/whoami',
    );
    await expect(fetchParticipantId(configWith(200, '{"ok":true}'))).rejects.toThrow(
      'participantId',
    );
  });
});
