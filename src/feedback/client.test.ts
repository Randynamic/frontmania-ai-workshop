import { afterEach, describe, expect, test } from 'vitest';
import { backendConfigFrom } from '../backend/client.js';
import { postFeedback } from './client.js';
import { clearCurrentRun, getCurrentRun, setCurrentRun } from './current-run.js';

afterEach(() => clearCurrentRun());

const configCapturing = (bodies: unknown[]) =>
  backendConfigFrom(
    { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
    {
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, id: '3' }), { status: 200 });
      },
    },
  );

describe('current run', () => {
  test('is set, read and cleared; an empty trace id is refused', () => {
    expect(getCurrentRun()).toBeUndefined();
    setCurrentRun({ traceId: 'tr-1', kind: 'plan' });
    expect(getCurrentRun()).toEqual({ traceId: 'tr-1', kind: 'plan' });
    expect(() => setCurrentRun({ traceId: '', kind: 'plan' })).toThrow('empty');
    clearCurrentRun();
    expect(getCurrentRun()).toBeUndefined();
  });
});

describe('postFeedback', () => {
  test('posts the verdict with the current run trace id', async () => {
    const bodies: unknown[] = [];
    setCurrentRun({ traceId: 'tr-9', kind: 'agent' });
    const receipt = await postFeedback(
      { slot: '14:15', thumb: 'up', reason: 'matches my stack' },
      { config: configCapturing(bodies) },
    );
    expect(receipt).toEqual({ ok: true, id: '3' });
    expect(bodies[0]).toEqual({
      slot: '14:15',
      thumb: 'up',
      reason: 'matches my stack',
      traceId: 'tr-9',
    });
  });

  test('an explicit run wins over the current one', async () => {
    const bodies: unknown[] = [];
    setCurrentRun({ traceId: 'tr-9', kind: 'agent' });
    await postFeedback(
      { slot: '15:30', thumb: 'down', reason: 'too basic' },
      { config: configCapturing(bodies), run: { traceId: 'tr-2', kind: 'plan' } },
    );
    expect(bodies[0]).toMatchObject({ traceId: 'tr-2' });
  });

  test('refuses invalid input and a missing run before touching the network', async () => {
    const bodies: unknown[] = [];
    await expect(
      postFeedback(
        { slot: '14:15', thumb: 'up', reason: '' },
        { config: configCapturing(bodies), run: { traceId: 'tr-1', kind: 'plan' } },
      ),
    ).rejects.toThrow('feedback invalid at reason');
    await expect(
      postFeedback(
        { slot: '14:15', thumb: 'up', reason: 'x' },
        { config: configCapturing(bodies) },
      ),
    ).rejects.toThrow('no current run');
    expect(bodies).toHaveLength(0);
  });
});
