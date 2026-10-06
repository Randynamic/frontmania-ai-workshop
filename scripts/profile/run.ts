import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Mastra } from '@mastra/core';
import { backendConfigFrom, backendRequest, type BackendConfig } from '../../src/backend/client.js';
import { fetchParticipantId } from '../../src/backend/whoami.js';
import { REPO_ROOT } from '../../src/data/paths.js';
import { modelModeFrom, type ModelMode } from '../../src/mastra/model.js';
import { scrubEchoedIdentity } from '../../src/observability/echo-scrub.js';
import { registerRawText } from '../../src/observability/raw-text-registry.js';
import { registerRun, RUN_DIR, writeLastRun } from '../../src/run/record.js';
import { Profile } from '../../src/schemas/profile.js';
import { toMlflowTraceId } from '../../src/trace-id.js';
import { parseArgs, type ParsedArgs } from '../lib/args.js';

/**
 * pnpm run profile --cv <file> | --cv - | --skills "<text>"
 *
 * `--cv -` reads the CV from stdin (paste, then Ctrl-D), so an own CV never
 * has to exist as a file. One model call through the registered `profile` agent with structured
 * output, traced under the participant's pseudonym. The raw text is
 * registered with the masking registry before the call and is never
 * written anywhere: `.talk-picker/profile.json` holds the profile,
 * `.talk-picker/last-profile.json` the numbers `pnpm check:01` reads.
 *
 * The profile leaves this process (profile.json, POST /api/profiles, the
 * GEPA export, later ranker and planner prompts), where the trace masker no
 * longer knows the CV. So a name, employer, email or phone the model echoed
 * inside a value is replaced by the hash marker before anything is written
 * or posted (src/observability/echo-scrub.ts).
 *
 * In MODEL_MODE=mock the backend is skipped (no key, no network), so the
 * script also runs offline; the check's live layer then reports BLOCKED.
 */
export const PROFILE_FILE = 'profile.json';
export const MOCK_PARTICIPANT_ID = 'mock';
/** `--cv -`: read the CV from stdin; nothing is written to disk. */
export const STDIN_PATH = '-';
const JSON_INDENT = 2;
const USAGE =
  'usage: pnpm run profile --cv <file>  |  pnpm run profile --cv - (paste, then Ctrl-D)  |  pnpm run profile --skills "<what you do and want to see>"';

export type ProfileInput =
  | { readonly kind: 'cv'; readonly path: string; readonly text: string }
  | { readonly kind: 'stdin'; readonly text: string }
  | { readonly kind: 'skills'; readonly text: string };

/** What last-profile.json records about the input: where it came from and its hash, never the text. */
export type ProfileInputRecord =
  | { readonly kind: 'cv'; readonly path: string }
  | { readonly kind: 'stdin' }
  | { readonly kind: 'skills' };

export interface ProfileRunDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly mastra: Mastra;
  readonly readText: (path: string) => string;
  readonly runDir?: string;
  readonly backend?: BackendConfig;
  readonly now?: () => number;
  /**
   * Default true: `pnpm run profile` owns `mastra` and shuts it down, which
   * flushes the trace. A caller that keeps using the instance (`pnpm plan
   * --cv`) passes false and shuts it down itself; after shutdown the
   * instance traces nothing.
   */
  readonly shutdownWhenDone?: boolean;
}

export interface ProfileRunResult {
  readonly profile: Profile;
  readonly participantId: string;
  /** MLflow form (`tr-` + OTel hex): what the backend and check:01 look up. */
  readonly traceId: string;
  readonly tokens: number | null;
  readonly latencyMs: number;
  readonly input: ProfileInputRecord;
  /** mock: canned model answer, no backend; the numbers are not for the workbook. */
  readonly mode: ModelMode;
  /** Identity values (name, employer, email, phone) the model echoed and the scrub replaced. */
  readonly identityEchoesRemoved: number;
}

export const resolveInput = (
  args: ParsedArgs,
  readText: ProfileRunDeps['readText'],
): ProfileInput => {
  const cv = args.flags.cv;
  const skills = args.flags.skills;
  if (typeof cv === 'string' && typeof skills === 'string') {
    throw new Error(`give either --cv or --skills, not both\n${USAGE}`);
  }
  if (cv === STDIN_PATH) {
    const text = readText(STDIN_PATH);
    if (text.trim().length === 0)
      throw new Error(`nothing on stdin: paste your CV, then press Ctrl-D\n${USAGE}`);
    return { kind: 'stdin', text };
  }
  if (typeof cv === 'string') {
    const path = resolve(REPO_ROOT, cv);
    const text = (() => {
      try {
        return readText(path);
      } catch {
        throw new Error(
          `cannot read ${cv}; check the path (persona CVs live in data/cvs/)\n${USAGE}`,
        );
      }
    })();
    if (text.trim().length === 0) throw new Error(`${cv} is empty`);
    return { kind: 'cv', path, text };
  }
  if (typeof skills === 'string' && skills.trim().length > 0) {
    return { kind: 'skills', text: skills };
  }
  throw new Error(USAGE);
};

const toRecord = (input: ProfileInput): ProfileInputRecord =>
  input.kind === 'cv' ? { kind: 'cv', path: input.path } : { kind: input.kind };

export const inputHash = (text: string): string =>
  createHash('sha256').update(text.trim(), 'utf8').digest('hex');

const generateProfile = async (
  mastra: Mastra,
  text: string,
  participantId: string,
  now: () => number,
): Promise<{ profile: Profile; traceId: string; tokens: number | null; latencyMs: number }> => {
  const started = now();
  const result = await mastra.getAgent('profile').generate(text, {
    structuredOutput: { schema: Profile, errorStrategy: 'strict' },
    tracingOptions: { metadata: { participantId, kind: 'profile' } },
  });
  const latencyMs = now() - started;
  if (!result.traceId) {
    throw new Error(
      'the agent run produced no trace id; is observability configured in src/mastra/index.ts?',
    );
  }
  return {
    profile: result.object,
    traceId: toMlflowTraceId(result.traceId),
    tokens: result.usage.totalTokens ?? null,
    latencyMs,
  };
};

/** Writes `.talk-picker/profile.json`, what `pnpm plan` and `pnpm compare` read by default. */
export const writeProfileFile = (profile: Profile, dir: string): string => {
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, PROFILE_FILE);
  writeFileSync(path, `${JSON.stringify(profile, null, JSON_INDENT)}\n`, 'utf8');
  return path;
};

/**
 * Replaces identity values of the raw text that the model echoed inside the
 * profile, then validates again: the saved and posted profile is the scrubbed one.
 */
export const scrubProfile = (
  profile: Profile,
  rawText: string,
  marker: string,
): { readonly profile: Profile; readonly identityEchoesRemoved: number } => {
  const scrubbed = scrubEchoedIdentity(profile, rawText, marker);
  if (scrubbed.replaced === 0) return { profile, identityEchoesRemoved: 0 };
  const parsed = Profile.safeParse(scrubbed.value);
  if (!parsed.success) {
    throw new Error(
      'the model copied your name, employer or contact details into the profile, and the profile is not valid once they are removed; run the command again (nothing was saved or sent)',
    );
  }
  return { profile: parsed.data, identityEchoesRemoved: scrubbed.replaced };
};

/** Runs the whole flow; throws with a message a participant can act on. */
export const runProfile = async (
  argv: readonly string[],
  deps: ProfileRunDeps,
): Promise<ProfileRunResult> => {
  const now = deps.now ?? Date.now;
  const runDir = deps.runDir ?? RUN_DIR;
  const mode = modelModeFrom(deps.env);
  const isMock = mode === 'mock';
  const input = resolveInput(parseArgs(argv), deps.readText);
  const { marker } = registerRawText(input.text);

  const backend = isMock ? undefined : (deps.backend ?? backendConfigFrom(deps.env));
  const participantId = backend ? await fetchParticipantId(backend) : MOCK_PARTICIPANT_ID;

  const generated = await generateProfile(deps.mastra, input.text, participantId, now);
  // Flush the exporter before anything reads the trace; batched spans leave the process here.
  if (deps.shutdownWhenDone ?? true) await deps.mastra.shutdown();

  const { profile, identityEchoesRemoved } = scrubProfile(generated.profile, input.text, marker);
  writeProfileFile(profile, runDir);
  writeLastRun(
    'profile',
    {
      traceId: generated.traceId,
      tokens: generated.tokens,
      latencyMs: generated.latencyMs,
      profile,
      participantId,
      mode,
      input: toRecord(input),
      inputHash: inputHash(input.text),
    },
    runDir,
  );

  if (backend) {
    await backendRequest(backend, '/api/profiles', {
      method: 'POST',
      body: { profile },
    });
    await registerRun(generated.traceId, 'profile', { config: backend });
  }

  return {
    ...generated,
    profile,
    participantId,
    input: toRecord(input),
    mode,
    identityEchoesRemoved,
  };
};

const PROFILE_FIELDS = ['role', 'seniority', 'stack', 'interests', 'avoid'] as const;
const LABEL_WIDTH = 12;

export const formatProfile = (profile: Profile): string => {
  const list = (values: readonly string[]): string =>
    values.length > 0 ? values.join(', ') : '(none)';
  const label = (name: string): string => name.padEnd(LABEL_WIDTH);
  const known = [
    `${label('role')}${profile.role}`,
    `${label('seniority')}${profile.seniority}`,
    `${label('stack')}${list(profile.stack)}`,
    `${label('interests')}${list(profile.interests)}`,
    `${label('avoid')}${list(profile.avoid)}`,
  ];
  // Stretch fields (for example `confidence`) print as JSON, whatever the schema on this branch adds.
  const extras = Object.entries(profile)
    .filter(
      ([key, value]) => !(PROFILE_FIELDS as readonly string[]).includes(key) && value !== undefined,
    )
    .map(([key, value]) => `${label(key)}${JSON.stringify(value)}`);
  return [...known, ...extras].join('\n');
};

const echoLines = (result: ProfileRunResult): readonly string[] =>
  result.identityEchoesRemoved > 0
    ? [
        `removed ${result.identityEchoesRemoved} name, employer or contact value(s) the model copied into the profile; the saved profile shows [cv:sha256:…] there`,
      ]
    : [];

const formatNumbers = (result: ProfileRunResult): string =>
  result.mode === 'mock'
    ? [
        `tokens: ${result.tokens ?? 'n/a'} (mock, not for the workbook)  latency: ${result.latencyMs} ms (mock)`,
        `trace: ${result.traceId}  participant: ${result.participantId} (MODEL_MODE=mock, nothing sent to the backend)`,
        `saved .talk-picker/${PROFILE_FILE}: it now holds the canned mock profile, not yours; run \`pnpm run profile\` without MODEL_MODE=mock to replace it`,
      ].join('\n')
    : [
        `tokens: ${result.tokens ?? 'n/a'}  latency: ${result.latencyMs} ms`,
        `trace: ${result.traceId}  participant: ${result.participantId}`,
        `saved .talk-picker/${PROFILE_FILE} and .talk-picker/last-profile.json (no CV text)`,
      ].join('\n');

export const formatRunSummary = (result: ProfileRunResult): string =>
  [...echoLines(result), formatNumbers(result)].join('\n');
