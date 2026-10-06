import { describe, expect, test } from 'vitest';
import { loadPersonas } from '../../../data/personas.js';
import { loadProgram, talksForSlot } from '../../../data/program.js';
import { RANKER_SEED } from '../../../prompts/seed.js';
import { SlotRanking } from '../../../schemas/slot-ranking.js';
import { createRankerAgent } from '../../agents/ranker.js';
import { createMastra } from '../../index.js';
import { createMockTaskModel, type MockPrompt } from '../../model.js';
import { promptText, routedMockReply } from '../../mock-replies.js';
import { rankSlot } from './rank-slot.js';

const { program } = loadProgram(undefined, () => undefined);
const profile = loadPersonas()[1]!.profile;
const talks = [...talksForSlot(program, '14:15')];

const runStep = async (reply: (prompt: MockPrompt) => string) => {
  const seen: string[] = [];
  const mastra = createMastra(
    { MODEL_MODE: 'mock' },
    {
      agents: {
        ranker: createRankerAgent(
          createMockTaskModel((prompt) => {
            seen.push(promptText(prompt));
            return reply(prompt);
          }),
        ),
      },
    },
  );
  const result = await rankSlot.execute({
    inputData: { profile, slot: '14:15', talks },
    mastra,
  } as never);
  return { result, seen };
};

describe('rankSlot', () => {
  test('renders the registry prompt with the persona profile and returns a validating ranking', async () => {
    // Arrange
    const answer = {
      slot: '14:15',
      ranking: talks.map((t) => t.id),
      reason: 'the stack matches',
      confidence: 0.8,
    };

    // Act
    const { result, seen } = await runStep(() => JSON.stringify(answer));

    // Assert
    expect(SlotRanking.parse(result)).toEqual(answer);
    expect(seen).toHaveLength(1);
    const prompt = seen[0]!;
    expect(prompt).toContain(JSON.stringify(profile));
    expect(prompt).toContain('Slot: 14:15');
    for (const talk of talks) expect(prompt).toContain(`[${talk.id}] ${talk.title}`);
    expect(prompt).toContain(RANKER_SEED.slice(0, 40));
    expect(prompt).not.toContain('{{');
  });

  test('the default mock answer ranks every talk of the slot exactly once', async () => {
    const { result } = await runStep(routedMockReply);
    const ranking = SlotRanking.parse(result);
    expect([...ranking.ranking].sort()).toEqual(talks.map((t) => t.id).sort());
    expect(ranking.slot).toBe('14:15');
  });

  test('a malformed model answer fails the step (structured output is validated, not guaranteed)', async () => {
    await expect(
      runStep(() => JSON.stringify({ slot: '14:15', ranking: [], reason: 'r', confidence: 0.5 })),
    ).rejects.toThrow();
    await expect(runStep(() => 'not json')).rejects.toThrow();
  });

  test('rejects ids outside the slot', async () => {
    const foreignId = talksForSlot(program, '15:30')[0]!.id;
    const answer = {
      slot: '14:15',
      ranking: [talks[0]!.id, foreignId],
      reason: 'r',
      confidence: 0.5,
    };
    await expect(runStep(() => JSON.stringify(answer))).rejects.toThrow(
      `outside slot 14:15: ${foreignId}`,
    );
  });

  test('keeps the slot it was asked about when the model names another', async () => {
    const answer = { slot: '16:30', ranking: talks.map((t) => t.id), reason: 'r', confidence: 0.5 };
    const { result } = await runStep(() => JSON.stringify(answer));
    expect(SlotRanking.parse(result).slot).toBe('14:15');
  });
});
