import { describe, expect, test } from 'vitest';
import { SlotRanking } from '../../schemas/slot-ranking.js';
import { createMockTaskModel } from '../model.js';
import { createRankerAgent, RANKER_AGENT_ID, RANKER_INSTRUCTIONS, rankerAgent } from './ranker.js';

describe('rankerAgent', () => {
  test('is wired with fixed one-line instructions; the prompt arrives per call', async () => {
    expect(rankerAgent.id).toBe(RANKER_AGENT_ID);
    expect(rankerAgent.name).toBe('ranker');
    expect(await rankerAgent.getInstructions()).toBe(RANKER_INSTRUCTIONS);
    expect(RANKER_INSTRUCTIONS).not.toContain('{{');
  });

  test('a scripted answer comes back as a validated SlotRanking', async () => {
    const agent = createRankerAgent(
      createMockTaskModel(() =>
        JSON.stringify({ slot: '14:15', ranking: ['fm26-1'], reason: 'fit', confidence: 0.9 }),
      ),
    );
    const result = await agent.generate('rank these', {
      structuredOutput: { schema: SlotRanking, errorStrategy: 'strict' },
    });
    expect(result.object).toEqual({
      slot: '14:15',
      ranking: ['fm26-1'],
      reason: 'fit',
      confidence: 0.9,
    });
  });

  test('strict structured output rejects a confidence above 1', async () => {
    const agent = createRankerAgent(
      createMockTaskModel(() =>
        JSON.stringify({ slot: '14:15', ranking: ['fm26-1'], reason: 'fit', confidence: 2 }),
      ),
    );
    await expect(
      agent.generate('rank', {
        structuredOutput: { schema: SlotRanking, errorStrategy: 'strict' },
      }),
    ).rejects.toThrow();
  });
});
