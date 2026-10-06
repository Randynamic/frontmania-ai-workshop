import { describe, expect, test } from 'vitest';
import { loadPersonas } from '../../src/data/personas.js';
import { talksForSlot } from '../../src/data/program.js';
import { AGENTS, createMastra } from '../../src/mastra/index.js';
import { programOnce } from '../../src/mastra/workflows/steps/expand-slots.js';
import { SlotRanking } from '../../src/schemas/slot-ranking.js';
import { RANKER_SEED } from '../../src/prompts/seed.js';
import { parseRankOnceArgs, rankOnce, renderPromptSource, renderRankerPrompt } from './run.js';

const persona = loadPersonas()[0]!;
const PROFILE = 'data/cvs/profiles/01-junior-angular-gov.json';

describe('rank-once', () => {
  test('parses its flags and rejects a missing or unknown slot', () => {
    const args = parseRankOnceArgs(['--profile', PROFILE, '--slot', '15:30', '--render-only']);
    expect(args).toEqual({ profile: persona.profile, slot: '15:30', renderOnly: true });
    expect(() => parseRankOnceArgs(['--profile', PROFILE])).toThrow('usage');
    expect(() => parseRankOnceArgs(['--profile', PROFILE, '--slot', '13:30'])).toThrow(
      '14:15, 15:30, 16:30',
    );
  });

  test("renders the production prompt with the persona and the slot's talks, no placeholders left", async () => {
    const prompt = await renderRankerPrompt(persona.profile, '16:30');
    expect(prompt).toContain(JSON.stringify(persona.profile));
    expect(prompt).toContain('Slot: 16:30');
    for (const talk of talksForSlot(programOnce().program, '16:30'))
      expect(prompt).toContain(`[${talk.id}]`);
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('[fm26-1227996]'); // a 14:15 talk
  });

  test('runs one ranking through the ranker agent', async () => {
    const mastra = createMastra({ MODEL_MODE: 'mock' }, { agents: AGENTS });
    const ranking = await rankOnce(persona.profile, '14:15', mastra);
    expect(SlotRanking.safeParse(ranking).success).toBe(true);
    expect(ranking.slot).toBe('14:15');
    expect(ranking.ranking).toHaveLength(6);
  });

  test('--render-only needs no key: without one it renders the seed template and says so', async () => {
    // Arrange
    const noKey = renderPromptSource({
      MODEL_MODE: 'live',
      WORKSHOP_BACKEND_URL: 'https://ws.test',
    });

    // Act
    const prompt = await renderRankerPrompt(persona.profile, '14:15', noKey.load);

    // Assert
    expect(noKey.note).toContain('seed ranker template');
    expect(prompt).toContain(RANKER_SEED.slice(0, 40));
    expect(prompt).not.toContain('{{');
  });

  test('with a key it reads the registry; in mock mode the seed, silently', () => {
    const withKey = renderPromptSource({
      MODEL_MODE: 'live',
      WORKSHOP_BACKEND_URL: 'https://ws.test',
      PROXY_API_KEY: 'sk-card',
    });
    expect(withKey.note).toBeUndefined();
    expect(renderPromptSource({ MODEL_MODE: 'mock' }).note).toBeUndefined();
  });
});
