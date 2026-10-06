import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Store } from './store.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
let store: Store;

beforeEach(async () => {
  store = await Store.open(':memory:');
});
afterEach(() => store.close());

describe('keys and ids', () => {
  test('slip keys are linked at creation, page keys after register', async () => {
    await store.addKey(HASH_A, 'otter-42', true, 1);
    await store.addKey(HASH_B, 'heron-10', false, 2);
    expect(await store.findKey(HASH_A)).toEqual({
      keyHash: HASH_A,
      pseudonym: 'otter-42',
      revokedAt: null,
      linkedAt: 1,
    });
    expect((await store.findKey(HASH_B))?.linkedAt).toBeNull();
    await store.linkKey(HASH_B, 'lynx-77', 3);
    expect(await store.findKey(HASH_B)).toMatchObject({ pseudonym: 'lynx-77', linkedAt: 3 });
    await store.linkKey(HASH_B, 'lynx-77', 9);
    expect((await store.findKey(HASH_B))?.linkedAt).toBe(3);
    await expect(store.linkKey(HASH_B, 'otter-42')).rejects.toThrow();
    expect(await store.findKey('c'.repeat(64))).toBeUndefined();
  });

  test('isKeyPseudonym sees placeholders and linked ids, not page-issued ids', async () => {
    await store.addKey(HASH_A, 'otter-42', false, 1);
    await store.issueId('lynx-77', 2);
    expect(await store.isKeyPseudonym('otter-42')).toBe(true);
    expect(await store.isKeyPseudonym('lynx-77')).toBe(false);
    await store.linkKey(HASH_A, 'lynx-77', 3);
    expect(await store.isKeyPseudonym('lynx-77')).toBe(true);
    expect(await store.isKeyPseudonym('otter-42')).toBe(false);
  });

  test('revoke all is idempotent and listPseudonyms keeps creation order', async () => {
    await store.addKey(HASH_A, 'otter-42', true, 1);
    await store.addKey(HASH_B, 'heron-10', true, 2);
    expect(await store.listPseudonyms()).toEqual(['otter-42', 'heron-10']);
    expect(await store.revokeAllKeys(50)).toBe(2);
    expect(await store.revokeAllKeys(60)).toBe(0);
    expect((await store.findKey(HASH_A))?.revokedAt).toBe(50);
  });

  test('issued ids are remembered once', async () => {
    await store.issueId('heron-10', 1);
    await store.issueId('heron-10', 2);
    expect(await store.hasIssuedId('heron-10')).toBe(true);
    expect(await store.hasIssuedId('heron-11')).toBe(false);
  });
});

describe('picks, profiles, runs, feedback', () => {
  test('picks: first write wins and is final, missing is null', async () => {
    expect(await store.savePicks('otter-42', { '14:15': 'a' }, 1)).toBe(true);
    expect(await store.savePicks('otter-42', { '14:15': 'b', '15:30': 'c' }, 2)).toBe(false);
    expect(await store.getPicks('otter-42')).toEqual({ '14:15': 'a' });
    expect(await store.getPicks('heron-10')).toBeNull();
  });

  test('runs round-trip and plan runs with picks await expectations', async () => {
    await store.saveRun('tr-1', 'otter-42', 'profile', 5);
    await store.saveRun('tr-1', 'otter-42', 'plan', 6);
    expect(await store.findRun('tr-1')).toEqual({
      traceId: 'tr-1',
      participantId: 'otter-42',
      kind: 'plan',
      createdAt: 5,
    });
    expect(await store.runsAwaitingExpectations()).toEqual([]);
    await store.savePicks('otter-42', { '14:15': 'a' }, 7);
    expect((await store.runsAwaitingExpectations()).map((r) => r.traceId)).toEqual(['tr-1']);
    await store.markExpectationsAttached('tr-1', 8);
    expect(await store.runsAwaitingExpectations()).toEqual([]);
  });

  test('feedback tracks attempts and attachment, scoped per participant', async () => {
    const id = await store.saveFeedback(
      { participantId: 'otter-42', traceId: 'tr-1', slot: '14:15', thumb: 'up', reason: 'good' },
      6,
    );
    expect(id).toBe(1);
    expect((await store.pendingFeedback(2)).map((r) => r.id)).toEqual([1]);
    await store.markFeedbackAttempt(1);
    await store.markFeedbackAttempt(1);
    expect(await store.pendingFeedback(2)).toEqual([]);
    await store.markFeedbackAttached(1, 9);
    const rows = await store.listFeedbackByTrace('tr-1', 'otter-42');
    expect(rows[0]).toMatchObject({
      id: 1,
      slot: '14:15',
      thumb: 'up',
      reason: 'good',
      createdAt: 6,
      attachedAt: 9,
    });
    expect(await store.listFeedbackByTrace('tr-1', 'heron-10')).toEqual([]);
  });

  test('stats, export and wipe cover every table', async () => {
    await store.addKey(HASH_A, 'otter-42', true, 1);
    await store.issueId('otter-42', 1);
    await store.savePicks('otter-42', { '14:15': 'a' }, 2);
    await store.saveProfile('otter-42', { role: 'old' }, 3);
    await store.saveProfile('otter-42', { role: 'new' }, 4);
    await store.saveRun('tr-1', 'otter-42', 'plan', 5);
    await store.saveFeedback(
      { participantId: 'otter-42', traceId: 'tr-1', slot: '14:15', thumb: 'down', reason: 'no' },
      6,
    );
    expect(await store.stats()).toEqual({
      keys: 1,
      keysRevoked: 0,
      picks: 1,
      profiles: 2,
      runs: 1,
      feedback: 1,
      feedbackAttached: 0,
    });
    expect(await store.exportAll()).toEqual([
      {
        participantId: 'otter-42',
        profile: { role: 'new' },
        picks: { '14:15': 'a' },
        feedback: [{ slot: '14:15', thumb: 'down', reason: 'no', traceId: 'tr-1' }],
      },
    ]);
    expect(await store.wipe()).toBe(7);
    expect(await store.stats()).toMatchObject({
      keys: 0,
      picks: 0,
      profiles: 0,
      runs: 0,
      feedback: 0,
    });
    expect(await store.hasIssuedId('otter-42')).toBe(false);
  });
});
