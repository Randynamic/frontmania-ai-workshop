import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { DATA_PATHS } from '../../../src/data/paths.js';
import { createMockTaskModel } from '../../../src/mastra/model.js';
import {
  extraRequiredFields,
  instructionsText,
  loadExerciseModules01,
  MIN_INSTRUCTION_LENGTH,
  staticChecks01,
} from './static.js';

/**
 * Branch-independent: the solved and the start state are built inline, so
 * this file is identical on 01-start and 01-done and the suite is green on
 * both. The real files are exercised by `pnpm check:01 --static` itself.
 */
const sampleCv = readFileSync(resolve(DATA_PATHS.cvsDir, '02-senior-react-architect.md'), 'utf8');

const SolvedProfile = z
  .object({
    role: z.string().min(1),
    seniority: z.enum(['junior', 'medior', 'senior', 'lead']),
    stack: z.array(z.string().min(1)).max(10),
    interests: z.array(z.string().min(1)).max(8),
    avoid: z.array(z.string().min(1)).max(5),
  })
  .strict();
const solvedInstructions = `You extract a conference profile: role, seniority (junior, medior, senior, lead; when years are not stated, infer from scope and pick the lower level in doubt), stack, interests and topics to avoid. Never output names, employers or contact details. Vague input yields shorter arrays and a lower seniority.`;
const solvedAgent = (reply?: () => string) =>
  new Agent({
    id: 'profile-agent',
    name: 'profile',
    instructions: solvedInstructions,
    model: createMockTaskModel(reply),
  });
const cleanSources = {
  schema: 'export const Profile = ...',
  agent: 'export const profileAgent = ...',
};

/** What the 01-start branch ships: unbounded arrays, one-line instructions, markers in place. */
const StartProfile = z.object({
  role: z.string(),
  seniority: z.enum(['junior', 'medior', 'senior', 'lead']),
  stack: z.array(z.string()),
  interests: z.array(z.string()),
  avoid: z.array(z.string()),
});
const startAgent = new Agent({
  id: 'profile-agent',
  name: 'profile',
  instructions: 'TODO: extract a profile.',
  model: createMockTaskModel(),
});
const startSources = {
  schema: '// TODO(exercise 01, step 1): bound the arrays',
  agent: '// TODO(exercise 01, step 2): write the instructions',
};

describe('staticChecks01', () => {
  test('passes on the solved state', async () => {
    expect(solvedInstructions.length).toBeGreaterThanOrEqual(MIN_INSTRUCTION_LENGTH);
    const lines = await staticChecks01({
      Profile: SolvedProfile,
      agent: solvedAgent(),
      sources: cleanSources,
      sampleCv,
    });
    expect(lines.filter((l) => l.status !== 'OK')).toEqual([]);
    expect(lines.map((l) => l.name)).toContain('mock run yields a valid Profile');
  });

  test('on the start state every FAIL names its step', async () => {
    const lines = await staticChecks01({
      Profile: StartProfile,
      agent: startAgent,
      sources: startSources,
      sampleCv,
    });
    const failures = lines.filter((l) => l.status === 'FAIL');
    expect(failures.map((l) => l.name)).toEqual([
      'stack bounded',
      'interests bounded',
      'avoid bounded',
      'no exercise marker in src/schemas/profile.ts',
      'no exercise marker in src/mastra/agents/profile.ts',
      'profile agent instructions',
    ]);
    expect(failures.find((l) => l.name === 'stack bounded')?.detail).toBe(
      'stack accepts 11 items, expected .max(10) (step 1)',
    );
    expect(failures.find((l) => l.name === 'profile agent instructions')?.detail).toContain(
      'TODO (step 2)',
    );
    for (const line of failures) expect(line.detail).toMatch(/\(step [12]\)$/);
  });

  test('an identity field, a wrong enum and a broken mock run are caught', async () => {
    const Leaky = SolvedProfile.extend({ name: z.string().optional(), seniority: z.string() });
    const lines = await staticChecks01({
      Profile: Leaky,
      agent: solvedAgent(() => 'not json'),
      sources: cleanSources,
      sampleCv,
    });
    const byName = Object.fromEntries(lines.map((l) => [l.name, l]));
    expect(byName['no identity field']?.status).toBe('FAIL');
    expect(byName['no identity field']?.detail).toContain('name');
    expect(byName['seniority is the four-level enum']?.status).toBe('FAIL');
    expect(byName['mock run yields a valid Profile']?.status).toBe('FAIL');
    expect(byName['mock run yields a valid Profile']?.detail).toContain('(step 2)');
  });

  test('a short instruction set without TODO reports its length', async () => {
    const short = new Agent({
      id: 'profile-agent',
      name: 'profile',
      instructions: 'Extract a profile.',
      model: createMockTaskModel(),
    });
    const lines = await staticChecks01({
      Profile: SolvedProfile,
      agent: short,
      sources: cleanSources,
      sampleCv,
    });
    expect(lines.find((l) => l.name === 'profile agent instructions')?.detail).toBe(
      `PROFILE_INSTRUCTIONS has 18 characters, expected at least ${MIN_INSTRUCTION_LENGTH} (step 2)`,
    );
  });

  test('instructionsText flattens strings, arrays and message objects', () => {
    expect(instructionsText('a')).toBe('a');
    expect(instructionsText(['a', 'b'])).toBe('a\nb');
    expect(instructionsText({ role: 'system', content: 'c' })).toBe('c');
    expect(instructionsText({ role: 'system', content: [{ type: 'text', text: 'd' }] })).toBe('');
    expect(instructionsText(42)).toBe('');
  });

  test('a required stretch field is named, and the lines that would blame step 1 are left out', async () => {
    // Arrange: stretch 1 written without .optional()
    const Stretched = SolvedProfile.extend({
      confidence: z.object({ role: z.number(), stack: z.number() }).partial(),
    });

    // Act
    const lines = await staticChecks01({
      Profile: Stretched,
      agent: solvedAgent(),
      sources: cleanSources,
      sampleCv,
    });

    // Assert
    const failures = lines.filter((l) => l.status === 'FAIL');
    expect(failures).toEqual([
      {
        status: 'FAIL',
        name: 'Profile parses a valid sample',
        detail: expect.stringMatching(/^confidence is required; add \.optional\(\)/),
      },
    ]);
    expect(lines.map((l) => l.name)).not.toContain('stack bounded');
    expect(lines.map((l) => l.name)).not.toContain('mock run yields a valid Profile');
  });

  test('the stretch written as .partial().optional() passes', async () => {
    const Stretched = SolvedProfile.extend({
      confidence: z
        .object({ role: z.number().min(0).max(1), stack: z.number().min(0).max(1) })
        .partial()
        .optional(),
    });
    expect(extraRequiredFields(Stretched)).toEqual([]);
    const lines = await staticChecks01({
      Profile: Stretched,
      agent: solvedAgent(),
      sources: cleanSources,
      sampleCv,
    });
    expect(lines.filter((l) => l.status !== 'OK')).toEqual([]);
  });
});

describe('loadExerciseModules01', () => {
  const esbuildError = (file: string): Error =>
    Object.assign(
      new Error(
        `Transform failed with 1 error:\n/repo/${file}:34:24: ERROR: Expected ";" but found "requested"`,
      ),
      { name: 'TransformError' },
    );

  test('a backtick in PROFILE_INSTRUCTIONS is one FAIL naming the file, the line and step 2', async () => {
    const loaded = await loadExerciseModules01({
      schema: async () => ({ Profile: SolvedProfile }),
      agent: async () => {
        throw esbuildError('src/mastra/agents/profile.ts');
      },
    });
    expect('lines' in loaded && loaded.lines).toEqual([
      { status: 'OK', name: 'src/schemas/profile.ts loads', detail: '' },
      {
        status: 'FAIL',
        name: 'src/mastra/agents/profile.ts loads',
        detail:
          'syntax error in src/mastra/agents/profile.ts (line 34: Expected ";" but found "requested"): no backticks or ${ inside PROFILE_INSTRUCTIONS (step 2)',
      },
    ]);
  });

  test('a ${name} in the instructions (ReferenceError at load) gets the same hint', async () => {
    const loaded = await loadExerciseModules01({
      schema: async () => ({ Profile: SolvedProfile }),
      agent: async () => {
        throw new ReferenceError('structure is not defined');
      },
    });
    expect('lines' in loaded && loaded.lines[1]?.detail).toBe(
      'syntax error in src/mastra/agents/profile.ts (structure is not defined): no backticks or ${ inside PROFILE_INSTRUCTIONS (step 2)',
    );
  });

  test('a broken schema file fails first and names step 1', async () => {
    const loaded = await loadExerciseModules01({
      schema: async () => {
        throw esbuildError('src/schemas/profile.ts');
      },
      agent: async () => ({ profileAgent: solvedAgent() }),
    });
    expect('lines' in loaded && loaded.lines).toHaveLength(1);
    expect('lines' in loaded && loaded.lines[0]?.detail).toMatch(
      /^syntax error in src\/schemas\/profile\.ts \(line 34: .*\(step 1\)$/,
    );
  });

  test('loads both modules when they compile', async () => {
    const agent = solvedAgent();
    const loaded = await loadExerciseModules01({
      schema: async () => ({ Profile: SolvedProfile }),
      agent: async () => ({ profileAgent: agent }),
    });
    expect('modules' in loaded && loaded.modules.agent).toBe(agent);
  });
});
