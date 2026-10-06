import type { Agent } from '@mastra/core/agent';
import type { z } from 'zod';
import { IDENTITY_KEYS, PROFILE_BOUNDS, SENIORITY } from '../../../src/data/personas.js';
import { assertion, fail, ok, type CheckLine } from '../lib.js';

/**
 * Static layer of pnpm check:01: runs offline against the participant's
 * schema and agent (mock model). The expected bounds come from
 * src/data/personas.ts, not from the file under test.
 */
export const MIN_INSTRUCTION_LENGTH = 200;
export const EXERCISE_MARKER = 'TODO(exercise 01';
const NOT_A_LEVEL = 'principal';

export interface StaticInputs01 {
  readonly Profile: z.ZodType;
  readonly agent: Agent;
  /** Source text of src/schemas/profile.ts and src/mastra/agents/profile.ts. */
  readonly sources: { readonly schema: string; readonly agent: string };
  readonly sampleCv: string;
}

const validSample = {
  role: 'front-end architect at a logistics scale-up',
  seniority: 'lead',
  stack: ['TypeScript', 'React', 'Next.js'],
  interests: ['tracing for LLM features', 'evaluation'],
  avoid: ['vendor keynotes'],
};

const items = (count: number): string[] => Array.from({ length: count }, (_, i) => `item-${i}`);

const shapeOf = (schema: z.ZodType): Readonly<Record<string, unknown>> =>
  (schema as { shape?: Record<string, unknown> }).shape ?? {};

const shapeKeys = (schema: z.ZodType): readonly string[] => Object.keys(shapeOf(schema));

/** The five fields of the exercise; anything else (a stretch field) must be optional. */
const PROFILE_FIELDS: readonly string[] = ['role', 'seniority', 'stack', 'interests', 'avoid'];

/** Fields beyond the five that reject `undefined`, so every valid profile without them fails. */
export const extraRequiredFields = (schema: z.ZodType): readonly string[] =>
  Object.entries(shapeOf(schema))
    .filter(([key]) => !PROFILE_FIELDS.includes(key))
    .filter(([, field]) => {
      const parse = (field as { safeParse?: (value: unknown) => { success: boolean } }).safeParse;
      return typeof parse === 'function' && !parse.call(field, undefined).success;
    })
    .map(([key]) => key);

const extraRequiredLine = (fields: readonly string[]): CheckLine =>
  fail(
    'Profile parses a valid sample',
    `${fields.join(', ')} ${fields.length === 1 ? 'is' : 'are'} required; add .optional() (a stretch field must not make the five fields of step 1 fail)`,
  );

/** Instructions may be a string, an array of strings, or message objects; the check reads the text. */
export const instructionsText = (instructions: unknown): string => {
  if (typeof instructions === 'string') return instructions;
  if (Array.isArray(instructions)) return instructions.map(instructionsText).join('\n');
  if (instructions && typeof instructions === 'object' && 'content' in instructions) {
    return instructionsText((instructions as { content: unknown }).content);
  }
  return '';
};

const schemaChecks = (Profile: z.ZodType): readonly CheckLine[] => {
  const parsed = Profile.safeParse(validSample);
  const hasAvoid =
    parsed.success &&
    typeof parsed.data === 'object' &&
    parsed.data !== null &&
    'avoid' in parsed.data;
  const bound = (field: keyof typeof PROFILE_BOUNDS): CheckLine => {
    const max = PROFILE_BOUNDS[field];
    const accepts = Profile.safeParse({ ...validSample, [field]: items(max) }).success;
    const rejects = !Profile.safeParse({ ...validSample, [field]: items(max + 1) }).success;
    return assertion(
      `${field} bounded`,
      accepts && rejects,
      accepts
        ? `${field} accepts ${max + 1} items, expected .max(${max}) (step 1)`
        : `${field} rejects ${max} items, expected .max(${max}) to accept them (step 1)`,
      `max ${max}`,
    );
  };
  const keys = shapeKeys(Profile);
  const identity = keys.filter((key) => (IDENTITY_KEYS as readonly string[]).includes(key));
  const identityLine = assertion(
    'no identity field',
    identity.length === 0,
    `Profile has ${identity.join(', ')}; a profile never carries a name, email, phone or employer (step 1)`,
  );
  const extraRequired = extraRequiredFields(Profile).filter((key) => !identity.includes(key));
  // Every sample below lacks the extra field, so the bound and enum lines would blame step 1 wrongly.
  if (extraRequired.length > 0) return [extraRequiredLine(extraRequired), identityLine];
  return [
    assertion(
      'Profile parses a valid sample',
      parsed.success && hasAvoid,
      parsed.success
        ? 'parsed object has no `avoid` field (step 1)'
        : 'valid sample rejected (step 1)',
    ),
    bound('stack'),
    bound('interests'),
    bound('avoid'),
    assertion(
      'seniority is the four-level enum',
      !Profile.safeParse({ ...validSample, seniority: NOT_A_LEVEL }).success &&
        SENIORITY.every((level) => Profile.safeParse({ ...validSample, seniority: level }).success),
      `seniority must be z.enum([${SENIORITY.map((s) => `'${s}'`).join(', ')}]) (step 1)`,
    ),
    identityLine,
  ];
};

const markerChecks = (sources: StaticInputs01['sources']): readonly CheckLine[] => [
  assertion(
    'no exercise marker in src/schemas/profile.ts',
    !sources.schema.includes(EXERCISE_MARKER),
    `a ${EXERCISE_MARKER}, step 1) marker remains (step 1)`,
  ),
  assertion(
    'no exercise marker in src/mastra/agents/profile.ts',
    !sources.agent.includes(EXERCISE_MARKER),
    `a ${EXERCISE_MARKER}, step 2) marker remains (step 2)`,
  ),
];

const instructionCheck = async (agent: Agent): Promise<CheckLine> => {
  const text = instructionsText(await agent.getInstructions());
  return assertion(
    'profile agent instructions',
    text.length >= MIN_INSTRUCTION_LENGTH && !text.includes('TODO'),
    text.includes('TODO')
      ? 'PROFILE_INSTRUCTIONS still contains TODO (step 2)'
      : `PROFILE_INSTRUCTIONS has ${text.length} characters, expected at least ${MIN_INSTRUCTION_LENGTH} (step 2)`,
    `${text.length} characters`,
  );
};

const mockRunCheck = (inputs: StaticInputs01): Promise<CheckLine> =>
  inputs.agent
    .generate(inputs.sampleCv, {
      structuredOutput: { schema: inputs.Profile, errorStrategy: 'strict' },
    })
    .then((result) =>
      assertion(
        'mock run yields a valid Profile',
        inputs.Profile.safeParse(result.object).success,
        'the agent answered but the object does not validate against Profile (step 2)',
      ),
    )
    .catch((error: unknown) =>
      fail(
        'mock run yields a valid Profile',
        `agent.generate threw: ${error instanceof Error ? error.message : String(error)} (step 2)`,
      ),
    );

export interface ExerciseModules01 {
  readonly Profile: z.ZodType;
  readonly agent: Agent;
}

/** How the check imports the two exercise files; tests pass fakes. */
export interface ExerciseImporters01 {
  readonly schema: () => Promise<{ readonly Profile: z.ZodType }>;
  readonly agent: () => Promise<{ readonly profileAgent: Agent }>;
}

export const SCHEMA_FILE = 'src/schemas/profile.ts';
export const AGENT_FILE = 'src/mastra/agents/profile.ts';

const defaultImporters: ExerciseImporters01 = {
  schema: () => import('../../../src/schemas/profile.js'),
  agent: () => import('../../../src/mastra/agents/profile.js'),
};

/** "line 34: Expected ";" but found "requested"" from an esbuild TransformError, else the first line. */
export const loadErrorSummary = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const esbuild = /:(\d+):\d+: ERROR: ([^\n]+)/.exec(message);
  if (esbuild) return `line ${esbuild[1]}: ${esbuild[2]}`;
  return message.split('\n')[0] ?? message;
};

type Attempt<T> = { readonly value: T } | { readonly error: unknown };

const attempt = <T>(load: () => Promise<T>): Promise<Attempt<T>> =>
  load().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

/**
 * Imports the participant's schema and agent. A syntax error there (a
 * backtick or `${` pasted into the PROFILE_INSTRUCTIONS template literal is
 * the usual one) becomes one FAIL line naming the file and the step, not a
 * stack trace from the TypeScript loader.
 */
export const loadExerciseModules01 = async (
  importers: ExerciseImporters01 = defaultImporters,
): Promise<{ readonly modules: ExerciseModules01 } | { readonly lines: readonly CheckLine[] }> => {
  const schema = await attempt(importers.schema);
  if ('error' in schema) {
    return {
      lines: [
        fail(
          `${SCHEMA_FILE} loads`,
          `syntax error in ${SCHEMA_FILE} (${loadErrorSummary(schema.error)}); compare your edit with the z.array(...).max(...) lines (step 1)`,
        ),
      ],
    };
  }
  const agent = await attempt(importers.agent);
  if ('error' in agent) {
    return {
      lines: [
        ok(`${SCHEMA_FILE} loads`),
        fail(
          `${AGENT_FILE} loads`,
          `syntax error in ${AGENT_FILE} (${loadErrorSummary(agent.error)}): no backticks or \${ inside PROFILE_INSTRUCTIONS (step 2)`,
        ),
      ],
    };
  }
  return { modules: { Profile: schema.value.Profile, agent: agent.value.profileAgent } };
};

export const staticChecks01 = async (inputs: StaticInputs01): Promise<readonly CheckLine[]> => {
  // With a required extra field every mock profile fails too; the schema line already names the cause.
  const hasExtraRequired = extraRequiredFields(inputs.Profile).length > 0;
  return [
    ...schemaChecks(inputs.Profile),
    ...markerChecks(inputs.sources),
    await instructionCheck(inputs.agent),
    ...(hasExtraRequired ? [] : [await mockRunCheck(inputs)]),
    ok('static layer', 'offline, mock model'),
  ];
};
