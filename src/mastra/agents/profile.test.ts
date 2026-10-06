import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DATA_PATHS } from '../../data/paths.js';
import { Profile } from '../../schemas/profile.js';
import { createMockTaskModel, DEFAULT_MOCK_REPLY, type MockReply } from '../model.js';
import {
  createProfileAgent,
  PROFILE_AGENT_ID,
  PROFILE_INSTRUCTIONS,
  profileAgent,
} from './profile.js';

const MIN_INSTRUCTION_LENGTH = 200;
const VAGUE_INPUT_LIMIT = 200;
const cvText = readFileSync(`${DATA_PATHS.cvsDir}/02-senior-react-architect.md`, 'utf8');

/** Canned model: a long CV yields a lead profile, a vague line yields a shorter, lower one. */
const seniorityAwareReply: MockReply = (prompt) => {
  const user = JSON.stringify(prompt.at(-1)?.content ?? '');
  const isVague = user.length < VAGUE_INPUT_LIMIT;
  return JSON.stringify(
    isVague
      ? {
          role: 'front-end developer',
          seniority: 'medior',
          stack: ['React'],
          interests: [],
          avoid: [],
        }
      : {
          role: 'front-end architect at a logistics scale-up',
          seniority: 'lead',
          stack: ['TypeScript', 'React', 'Next.js', 'Zod'],
          interests: ['tracing for LLM features', 'evaluation and cost per request'],
          avoid: ['Angular deep dives', 'vendor keynotes'],
        },
  );
};

const generateProfile = (reply: MockReply, input: string) =>
  createProfileAgent(createMockTaskModel(reply)).generate(input, {
    structuredOutput: { schema: Profile, errorStrategy: 'strict' },
  });

describe('PROFILE_INSTRUCTIONS', () => {
  test('is a complete instruction set without a placeholder', () => {
    expect(PROFILE_INSTRUCTIONS.length).toBeGreaterThanOrEqual(MIN_INSTRUCTION_LENGTH);
    expect(PROFILE_INSTRUCTIONS).not.toContain('TODO');
  });

  test('names every field, the seniority rule and the identity ban', () => {
    for (const word of ['role', 'seniority', 'stack', 'interests', 'avoid']) {
      expect(PROFILE_INSTRUCTIONS).toContain(`- ${word}:`);
    }
    expect(PROFILE_INSTRUCTIONS).toContain('junior, medior, senior, lead');
    expect(PROFILE_INSTRUCTIONS).toMatch(/years are not stated/i);
    expect(PROFILE_INSTRUCTIONS).toMatch(/never output names, employers/i);
    expect(PROFILE_INSTRUCTIONS).toMatch(/shorter arrays and a lower seniority/i);
  });
});

describe('profileAgent', () => {
  test('is wired with the id, the name and the instructions', async () => {
    expect(profileAgent.id).toBe(PROFILE_AGENT_ID);
    expect(profileAgent.name).toBe('profile');
    expect(await profileAgent.getInstructions()).toBe(PROFILE_INSTRUCTIONS);
  });

  test('a mock model answer comes back as a validated Profile object', async () => {
    // Arrange / Act
    const result = await generateProfile(DEFAULT_MOCK_REPLY, cvText);

    // Assert
    expect(Profile.safeParse(result.object).success).toBe(true);
    expect(result.object.avoid).toEqual([]);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  test('a full CV yields lead; a vague line yields medior or lower with shorter arrays', async () => {
    const full = await generateProfile(seniorityAwareReply, cvText);
    const vague = await generateProfile(seniorityAwareReply, 'I do some React.');
    expect(full.object.seniority).toBe('lead');
    expect(['junior', 'medior']).toContain(vague.object.seniority);
    expect(vague.object.stack.length).toBeLessThan(full.object.stack.length);
    expect(vague.object.interests).toEqual([]);
  });

  test('strict structured output rejects an answer with an identity field', async () => {
    const leaky: MockReply = () =>
      JSON.stringify({
        role: 'dev',
        seniority: 'senior',
        stack: [],
        interests: [],
        avoid: [],
        name: 'Lotte',
      });
    await expect(generateProfile(leaky, cvText)).rejects.toThrow();
  });
});
