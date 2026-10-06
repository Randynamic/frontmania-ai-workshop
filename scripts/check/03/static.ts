import { SLOTS } from '../../../src/schemas/talk.js';
import { instructionsText } from '../01/static.js';
import { assertion, fail, ok, type CheckLine } from '../lib.js';

/**
 * Static layer of pnpm check:03: offline. It reads the two exercise files
 * for leftover markers, probes the submitFeedback input schema with valid
 * and invalid verdicts, counts the planner's tools, reads its instructions,
 * and runs the two-turn ask once with the scripted mock planner.
 */
export const EXERCISE_MARKER = 'TODO(exercise 03';
export const EXPECTED_TOOLS = ['getTimetable', 'searchArchive', 'submitFeedback'] as const;
export const MIN_DESCRIPTION_LENGTH = 40;
export const MIN_INSTRUCTION_LENGTH = 200;
const TOO_LONG_REASON = 'x'.repeat(281);

/** The parts of a Mastra tool the check reads (`@mastra/core/tools` Tool: description, inputSchema). */
export interface ToolLike {
  readonly description?: string;
  readonly inputSchema?: unknown;
}

/** The parts of the planner agent the check reads (agent.d.ts: listTools, getInstructions). */
export interface AgentLike {
  listTools(): Promise<Record<string, unknown>>;
  getInstructions(): unknown;
}

export interface StaticInputs03 {
  readonly sources: { readonly submitFeedback: string; readonly planner: string };
  readonly submitFeedback: ToolLike;
  readonly planner: AgentLike;
  /** Runs `pnpm ask` offline with three verdicts and returns the feedback rows it produced. */
  readonly runTwoTurns: () => Promise<readonly { readonly slot: string }[]>;
}

interface StandardSchemaLike {
  readonly '~standard': {
    validate(value: unknown): { issues?: unknown } | Promise<{ issues?: unknown }>;
  };
}

const isStandardSchema = (schema: unknown): schema is StandardSchemaLike =>
  typeof schema === 'object' &&
  schema !== null &&
  '~standard' in schema &&
  typeof (schema as StandardSchemaLike)['~standard']?.validate === 'function';

const accepts = async (schema: StandardSchemaLike, value: unknown): Promise<boolean> => {
  const result = await schema['~standard'].validate(value);
  return !result.issues;
};

const markerChecks = (sources: StaticInputs03['sources']): readonly CheckLine[] => [
  assertion(
    'no exercise marker in src/mastra/tools/submit-feedback.ts',
    !sources.submitFeedback.includes(EXERCISE_MARKER),
    `a ${EXERCISE_MARKER}, step 1) marker remains (step 1)`,
  ),
  assertion(
    'no exercise marker in src/mastra/agents/planner.ts',
    !sources.planner.includes(EXERCISE_MARKER),
    `a ${EXERCISE_MARKER}, step 2) marker remains (step 2)`,
  ),
];

const schemaChecks = async (tool: ToolLike): Promise<readonly CheckLine[]> => {
  const schema = tool.inputSchema;
  if (!isStandardSchema(schema) || (await accepts(schema, {}))) {
    return [fail('submitFeedback input schema', 'submitFeedback has no input schema (step 1)')];
  }
  const valid = { slot: '14:15', thumb: 'up', reason: 'x' };
  const probes = [
    ['accepts a verdict', valid, true, 'rejects { slot: "14:15", thumb: "up", reason: "x" }'],
    ['rejects slot 13:30', { ...valid, slot: '13:30' }, false, 'accepts slot 13:30; use Slot'],
    [
      'rejects thumb "meh"',
      { ...valid, thumb: 'meh' },
      false,
      "accepts thumb 'meh'; use z.enum(['up', 'down'])",
    ],
    [
      'rejects a 281-character reason',
      { ...valid, reason: TOO_LONG_REASON },
      false,
      'accepts a 281-character reason; add .max(280)',
    ],
  ] as const;
  return Promise.all(
    probes.map(async ([name, value, shouldAccept, failDetail]) =>
      assertion(
        `submitFeedback input schema ${name}`,
        (await accepts(schema, value)) === shouldAccept,
        `${failDetail} (step 1)`,
      ),
    ),
  );
};

const descriptionCheck = (tool: ToolLike): CheckLine => {
  const length = tool.description?.trim().length ?? 0;
  return assertion(
    'submitFeedback description',
    length >= MIN_DESCRIPTION_LENGTH,
    `${length} characters, expected at least ${MIN_DESCRIPTION_LENGTH}: the model reads it to decide when to call the tool (step 1)`,
    `${length} characters`,
  );
};

const toolsCheck = async (planner: AgentLike): Promise<CheckLine> => {
  const names = Object.keys(await planner.listTools());
  if (names.length !== EXPECTED_TOOLS.length) {
    return fail(
      'planner tools',
      `planner has ${names.length} tools, expected ${EXPECTED_TOOLS.length} (step 2)`,
    );
  }
  const missing = EXPECTED_TOOLS.filter((name) => !names.includes(name));
  return assertion(
    'planner tools',
    missing.length === 0,
    `missing ${missing.join(', ')}; the keys must be ${EXPECTED_TOOLS.join(', ')} (step 2)`,
    names.join(', '),
  );
};

const instructionsCheck = async (planner: AgentLike): Promise<CheckLine> => {
  const text = instructionsText(await planner.getInstructions());
  return assertion(
    'planner instructions',
    text.length >= MIN_INSTRUCTION_LENGTH && !text.includes('TODO'),
    text.includes('TODO')
      ? 'PLANNER_INSTRUCTIONS still contains TODO (step 2)'
      : `PLANNER_INSTRUCTIONS has ${text.length} characters, expected at least ${MIN_INSTRUCTION_LENGTH} (step 2)`,
    `${text.length} characters`,
  );
};

const runCheck = async (inputs: StaticInputs03): Promise<CheckLine> => {
  const rows = await inputs.runTwoTurns().catch((error: unknown) => error);
  if (!Array.isArray(rows)) {
    const message = rows instanceof Error ? rows.message : String(rows);
    return fail('mock two-turn ask', `${message} (step 1 or 2; read the message)`);
  }
  const slots = new Set(rows.map((row: { slot: string }) => row.slot));
  const complete = rows.length === SLOTS.length && slots.size === SLOTS.length;
  return assertion(
    'mock two-turn ask',
    complete,
    `feedback rows: ${rows.length}, expected ${SLOTS.length} (step 1 or 2: submitFeedback.execute must call postFeedback and the planner must list it)`,
    `${rows.length} feedback rows, slots ${[...slots].join(', ')}`,
  );
};

export const staticChecks03 = async (inputs: StaticInputs03): Promise<readonly CheckLine[]> => [
  ...markerChecks(inputs.sources),
  ...(await schemaChecks(inputs.submitFeedback)),
  descriptionCheck(inputs.submitFeedback),
  await toolsCheck(inputs.planner),
  await instructionsCheck(inputs.planner),
  await runCheck(inputs),
  ok('static layer', 'offline, scripted mock planner, feedback kept in memory'),
];
