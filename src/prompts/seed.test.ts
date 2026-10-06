import { describe, expect, test } from 'vitest';
import { PROFILE_INSTRUCTIONS } from '../mastra/agents/profile.js';
import { RANKER_PROMPT_MARKER, TIP_PROMPT_MARKER } from '../mastra/mock-replies.js';
import { createPromptLoader } from './load.js';
import { promptVariables } from './render.js';
import { SEED_PROMPTS, SEED_VERSION, seedPromptVersion } from './seed.js';

describe('seed prompts', () => {
  test('ranker and tip declare exactly the variables the steps render', () => {
    expect(promptVariables(SEED_PROMPTS.ranker)).toEqual(['profile', 'slot', 'talks']);
    expect(promptVariables(SEED_PROMPTS.tip)).toEqual(['profile', 'ranking', 'candidates']);
    expect(promptVariables(SEED_PROMPTS.profile)).toEqual([]);
    expect(SEED_PROMPTS.profile).toBe(PROFILE_INSTRUCTIONS);
  });

  test('carry the markers the mock model routes on', () => {
    expect(SEED_PROMPTS.ranker).toContain(RANKER_PROMPT_MARKER);
    expect(SEED_PROMPTS.tip).toContain(TIP_PROMPT_MARKER);
    expect(SEED_PROMPTS.ranker).not.toContain(TIP_PROMPT_MARKER);
  });

  test('mock mode makes the loader answer from the seed without a backend', async () => {
    const loader = createPromptLoader({ env: { MODEL_MODE: 'mock' } });
    expect(await loader.load('ranker')).toEqual(seedPromptVersion('ranker'));
    expect((await loader.load('tip')).version).toBe(SEED_VERSION);
  });
});
