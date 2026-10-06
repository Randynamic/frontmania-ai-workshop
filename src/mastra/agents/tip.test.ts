import { describe, expect, test } from 'vitest';
import { Tip } from '../../schemas/tip.js';
import { createMockTaskModel } from '../model.js';
import { createTipAgent, TIP_AGENT_ID, TIP_INSTRUCTIONS, tipAgent } from './tip.js';

describe('tipAgent', () => {
  test('is wired with fixed instructions', async () => {
    expect(tipAgent.id).toBe(TIP_AGENT_ID);
    expect(await tipAgent.getInstructions()).toBe(TIP_INSTRUCTIONS);
  });

  test('a scripted answer comes back as a validated Tip', async () => {
    const agent = createTipAgent(
      createMockTaskModel(() =>
        JSON.stringify({ slot: '16:30', archiveTalkId: 'fm25-9', why: 'same topic' }),
      ),
    );
    const result = await agent.generate('tip', {
      structuredOutput: { schema: Tip, errorStrategy: 'strict' },
    });
    expect(result.object).toEqual({ slot: '16:30', archiveTalkId: 'fm25-9', why: 'same topic' });
  });
});
