import { z } from 'zod';
import { BackendError, BackendUnreachableError } from '../../../src/backend/client.js';
import { HASH_PREFIX } from '../../../src/observability/raw-text-registry.js';
import { MIN_LINE_LENGTH } from '../../../src/observability/mask.js';
import { Profile } from '../../../src/schemas/profile.js';
import type { LastRun } from '../../../src/run/record.js';
import { assertion, blocked, collectStrings, fail, ok, type CheckLine } from '../lib.js';

/**
 * Live layer of pnpm check:01: the last `pnpm run profile` run, its trace at
 * the backend, the masking proof and the numbers for the workbook.
 */
export const TRACE_WAIT_MS = 20_000;
export const TRACE_POLL_MS = 2_000;
/** The backend itself blocks up to TRACE_WAIT_MS per request; a shorter client timeout turns a missing trace into BLOCKED. */
export const TRACE_CLIENT_TIMEOUT_MS = TRACE_WAIT_MS + 5_000;
const HASH_LENGTH = 12;

export const TraceSpan = z.object({
  name: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  attributes: z.record(z.string(), z.unknown()),
});
export const TraceResponse = z.union([
  z.object({
    found: z.literal(true),
    tokens: z.number().nullable(),
    latencyMs: z.number().nullable(),
    spans: z.array(TraceSpan),
  }),
  z.object({ found: z.literal(false), error: z.string().optional() }),
]);
export type TraceResponse = z.infer<typeof TraceResponse>;

const ProfileRunExtras = z.object({
  profile: z.unknown(),
  input: z
    .union([
      z.object({ kind: z.literal('cv'), path: z.string() }),
      z.object({ kind: z.literal('stdin') }),
      z.object({ kind: z.literal('skills') }),
    ])
    .optional(),
  inputHash: z.string().optional(),
});

export interface LiveInputs01 {
  readonly lastRun: LastRun;
  /** One request to GET /api/traces/:traceId; throws BackendError or BackendUnreachableError. */
  readonly fetchTrace: (traceId: string) => Promise<TraceResponse>;
  /** The CV file of the last run, or undefined when it was typed skills or unreadable. */
  readonly readInput: (path: string) => string | undefined;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly progress?: (line: string) => void;
}

const longLines = (text: string): readonly string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_LINE_LENGTH);

const waitForTrace = async (
  inputs: LiveInputs01,
): Promise<{
  readonly line: CheckLine;
  readonly trace?: Extract<TraceResponse, { found: true }>;
}> => {
  const now = inputs.now ?? Date.now;
  const sleep = inputs.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const progress = inputs.progress ?? (() => undefined);
  const deadline = now() + TRACE_WAIT_MS;
  const traceId = inputs.lastRun.traceId;
  const attempt = async (): Promise<ReturnType<typeof waitForTrace>> => {
    try {
      const response = await inputs.fetchTrace(traceId);
      if (response.found)
        return { line: ok('trace found at the backend', traceId), trace: response };
      if (now() >= deadline) {
        return {
          line: fail(
            'trace found at the backend',
            `${traceId} not ingested within ${TRACE_WAIT_MS / 1000} s; the exporter batches, run the check again`,
          ),
        };
      }
      progress(`waiting for trace ${traceId} ...`);
      await sleep(TRACE_POLL_MS);
      return attempt();
    } catch (error) {
      if (error instanceof BackendUnreachableError) {
        return {
          line: blocked('trace found at the backend', error.message),
        };
      }
      if (error instanceof BackendError) {
        return { line: fail('trace found at the backend', error.message) };
      }
      throw error;
    }
  };
  return attempt();
};

const maskingLines = (
  trace: Extract<TraceResponse, { found: true }>,
  extras: z.infer<typeof ProfileRunExtras>,
  readInput: LiveInputs01['readInput'],
): readonly CheckLine[] => {
  const strings = collectStrings(trace.spans.map((s) => [s.input, s.output, s.attributes]));
  const expectedMarker = extras.inputHash
    ? `[${HASH_PREFIX}${extras.inputHash.slice(0, HASH_LENGTH)}]`
    : `[${HASH_PREFIX}`;
  const hasMarker = strings.some((value) => value.includes(expectedMarker));
  const inputText = extras.input?.kind === 'cv' ? readInput(extras.input.path) : undefined;
  const checked = inputText ? longLines(inputText) : [];
  const survivors = checked.filter((line) => strings.some((value) => value.includes(line)));
  const scope =
    extras.input?.kind === 'cv'
      ? inputText
        ? `${checked.length} CV lines checked`
        : 'CV file not readable, marker only'
      : extras.input?.kind === 'stdin'
        ? 'pasted CV, not on disk, marker only'
        : 'typed skills, marker only';
  return [
    assertion(
      'hash marker in trace',
      hasMarker,
      `${expectedMarker} not found in any span; is CvMaskingProcessor wired in src/mastra/index.ts?`,
      expectedMarker,
    ),
    assertion(
      'masked',
      hasMarker && survivors.length === 0,
      survivors.length > 0
        ? `NO: ${survivors.length} of ${checked.length} CV line(s) reached the trace in clear (not printed here); is registerRawText() called before the model call?`
        : 'NO: marker missing',
      `yes (${scope})`,
    ),
  ];
};

export const liveChecks01 = async (inputs: LiveInputs01): Promise<readonly CheckLine[]> => {
  const extras = ProfileRunExtras.safeParse(inputs.lastRun);
  if (!extras.success) {
    return [
      fail('last profile run', 'last-profile.json has no profile; run `pnpm run profile` again'),
    ];
  }
  const profileLine = assertion(
    'last profile validates',
    Profile.safeParse(extras.data.profile).success,
    'the recorded profile does not match Profile; run `pnpm run profile` again after fixing the schema (step 1)',
  );
  const { line, trace } = await waitForTrace(inputs);
  if (!trace) return [profileLine, line];
  const tokens = trace.tokens ?? inputs.lastRun.tokens;
  const latency = trace.latencyMs ?? inputs.lastRun.latencyMs;
  return [
    profileLine,
    line,
    ...maskingLines(trace, extras.data, inputs.readInput),
    ok('numbers for the workbook', `tokens: ${tokens ?? 'n/a'}  latency: ${latency ?? 'n/a'} ms`),
  ];
};
