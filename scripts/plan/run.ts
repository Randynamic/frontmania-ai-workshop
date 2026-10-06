import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Mastra } from '@mastra/core';
import { backendConfigFrom, type BackendConfig } from '../../src/backend/client.js';
import { fetchParticipantId } from '../../src/backend/whoami.js';
import { REPO_ROOT } from '../../src/data/paths.js';
import { talkById } from '../../src/data/program.js';
import { modelModeFrom } from '../../src/mastra/model.js';
import { programOnce } from '../../src/mastra/workflows/steps/expand-slots.js';
import { PLAN_WORKFLOW_ID } from '../../src/mastra/workflows/plan.js';
import type { TokenTallyExporter } from '../../src/observability/token-tally.js';
import { readLastRun, registerRun, RUN_DIR, writeLastRun } from '../../src/run/record.js';
import { Plan } from '../../src/schemas/plan.js';
import { Profile } from '../../src/schemas/profile.js';
import { SLOTS, type Slot } from '../../src/schemas/talk.js';
import { toMlflowTraceId } from '../../src/trace-id.js';
import { parseArgs } from '../lib/args.js';
import { MOCK_PARTICIPANT_ID, PROFILE_FILE, runProfile, writeProfileFile } from '../profile/run.js';

/**
 * pnpm plan [--profile <json> | --cv <file>]
 *
 * Runs the plan workflow (exercise 2) on the profile from `pnpm run profile`
 * (`.talk-picker/profile.json`), or on a persona profile, or on a CV that
 * is turned into a profile first. Prints the plan, the `top picks:` line
 * the workbook asks for, and on a rerun what changed since the last plan
 * (the reveal's 12:33 beat). Writes `.talk-picker/last-plan.json`.
 */
export const USAGE =
  'usage: pnpm plan  |  pnpm plan --profile data/cvs/profiles/<persona>.json  |  pnpm plan --cv <file>';

export type TopPicks = Readonly<Record<Slot, string>>;

export interface PlanRunDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly mastra: Mastra;
  /** Sums the model tokens of this run; wired as an exporter on `mastra`. */
  readonly tally?: TokenTallyExporter;
  readonly readText?: (path: string) => string;
  readonly runDir?: string;
  readonly backend?: BackendConfig;
  readonly now?: () => number;
}

export interface PlanRunResult {
  readonly plan: Plan;
  readonly topPicks: TopPicks;
  readonly previousTopPicks: TopPicks | undefined;
  readonly participantId: string;
  readonly traceId: string;
  readonly tokens: number | null;
  readonly latencyMs: number;
  readonly profileSource: string;
  /** True when --profile also became `.talk-picker/profile.json` because there was none. */
  readonly profileSaved: boolean;
}

export interface ResolvedProfile {
  readonly profile: Profile;
  readonly source: string;
  readonly saved: boolean;
}

/** A Profile JSON file, validated; `hint` is the message when the file is missing. */
export const readProfileFile = (path: string, hint: string): Profile => {
  if (!existsSync(path)) throw new Error(hint);
  const parsed = Profile.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `${path} is not a valid Profile at ${first?.path.join('.') || '<root>'}: ${first?.message}; run pnpm run profile again`,
    );
  }
  return parsed.data;
};

/** Where the profile comes from: --profile, --cv (regenerated), or the last `pnpm run profile`. */
export const resolveProfile = async (
  argv: readonly string[],
  deps: PlanRunDeps,
): Promise<ResolvedProfile> => {
  const args = parseArgs(argv);
  const runDir = deps.runDir ?? RUN_DIR;
  const fromFlag = args.flags.profile;
  const cv = args.flags.cv;
  if (typeof fromFlag === 'string' && typeof cv === 'string') {
    throw new Error(`give either --profile or --cv, not both\n${USAGE}`);
  }
  if (typeof fromFlag === 'string') {
    const profile = readProfileFile(
      resolve(REPO_ROOT, fromFlag),
      `cannot read ${fromFlag}; persona profiles live in data/cvs/profiles/\n${USAGE}`,
    );
    // Without a profile of your own, the persona becomes it, so a later bare `pnpm plan`
    // (also after switching to 02-done) does not stop at "no profile yet".
    const saved = !existsSync(resolve(runDir, PROFILE_FILE));
    if (saved) writeProfileFile(profile, runDir);
    return { profile, source: fromFlag, saved };
  }
  if (typeof cv === 'string') {
    const result = await runProfile(['--cv', cv], {
      env: deps.env,
      mastra: deps.mastra,
      readText: deps.readText ?? ((path) => readFileSync(path, 'utf8')),
      runDir,
      ...(deps.backend ? { backend: deps.backend } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      // The plan runs on the same instance next; runPlan shuts it down (and flushes both traces).
      shutdownWhenDone: false,
    });
    return { profile: result.profile, source: `${cv} (profile regenerated)`, saved: false };
  }
  const path = resolve(runDir, PROFILE_FILE);
  return {
    profile: readProfileFile(
      path,
      `no profile yet: run \`pnpm run profile --cv <file>\` first, or \`pnpm plan --profile data/cvs/profiles/<persona>.json\``,
    ),
    source: `.talk-picker/${PROFILE_FILE}`,
    saved: false,
  };
};

export const topPicksOf = (plan: Plan): TopPicks =>
  Object.fromEntries(
    SLOTS.map((slot) => [slot, plan.rankings.find((r) => r.slot === slot)?.ranking[0] ?? '']),
  ) as TopPicks;

/** The top picks of the previous `pnpm plan`, if any (read before this run overwrites the file). */
export const previousTopPicks = (runDir: string): TopPicks | undefined => {
  try {
    const last = readLastRun('plan', runDir);
    const parsed = last ? Plan.safeParse(last['plan']) : undefined;
    return parsed?.success ? topPicksOf(parsed.data) : undefined;
  } catch {
    return undefined;
  }
};
export const runPlan = async (
  argv: readonly string[],
  deps: PlanRunDeps,
): Promise<PlanRunResult> => {
  const now = deps.now ?? Date.now;
  const runDir = deps.runDir ?? RUN_DIR;
  const isMock = modelModeFrom(deps.env) === 'mock';
  const { profile, source, saved } = await resolveProfile(argv, deps);
  const backend = isMock ? undefined : (deps.backend ?? backendConfigFrom(deps.env));
  const participantId = backend ? await fetchParticipantId(backend) : MOCK_PARTICIPANT_ID;
  const previous = previousTopPicks(runDir);

  deps.tally?.reset();
  const run = await deps.mastra.getWorkflow(PLAN_WORKFLOW_ID).createRun();
  const started = now();
  const result = await run.start({
    inputData: { profile },
    tracingOptions: { metadata: { participantId, kind: 'plan' } },
  });
  const latencyMs = now() - started;
  await deps.mastra.shutdown();

  if (result.status !== 'success') {
    const failed = result.status === 'failed' ? result.error.message : `status ${result.status}`;
    throw new Error(`plan workflow did not finish: ${failed}`);
  }
  if (!result.traceId) {
    throw new Error(
      'the workflow run produced no trace id; is observability configured in src/mastra/index.ts?',
    );
  }
  const plan = Plan.parse(result.result);
  const topPicks = topPicksOf(plan);
  const traceId = toMlflowTraceId(result.traceId);
  const tokens = deps.tally?.snapshot().total ?? null;

  writeLastRun(
    'plan',
    { traceId, tokens, latencyMs, plan, topPicks, participantId, profile, profileSource: source },
    runDir,
  );
  if (backend) await registerRun(traceId, 'plan', { config: backend });

  return {
    plan,
    topPicks,
    previousTopPicks: previous,
    participantId,
    traceId,
    tokens,
    latencyMs,
    profileSource: source,
    profileSaved: saved,
  };
};

const RANK_WIDTH = 3;

export const formatPlan = (plan: Plan): string => {
  const { program } = programOnce();
  const title = (id: string): string => talkById(program, id)?.title ?? '(unknown talk)';
  const blocks = plan.rankings.map((ranking) => {
    const lines = ranking.ranking.map(
      (id, index) => `  ${String(index + 1).padStart(RANK_WIDTH)}. [${id}] ${title(id)}`,
    );
    const tip = plan.tips.find((t) => t.slot === ranking.slot);
    return [
      `${ranking.slot}  (confidence ${ranking.confidence.toFixed(2)})`,
      ...lines,
      `  why: ${ranking.reason}`,
      tip ? `  tip: [${tip.archiveTalkId}] ${tip.why}` : '  tip: none',
    ].join('\n');
  });
  return blocks.join('\n\n');
};

export const formatTopPicks = (picks: TopPicks): string =>
  `top picks: ${SLOTS.map((slot) => `${slot} ${picks[slot] || '-'}`).join(' | ')}`;

export const formatChanges = (
  previous: TopPicks | undefined,
  current: TopPicks,
): string | undefined => {
  if (!previous) return undefined;
  const changed = SLOTS.filter((slot) => previous[slot] !== current[slot]).map(
    (slot) => `${slot} ${previous[slot] || '-'} -> ${current[slot] || '-'}`,
  );
  return changed.length > 0
    ? `changed since last run: ${changed.join(', ')}`
    : 'changed since last run: nothing, same three top picks';
};

export const formatRunSummary = (result: PlanRunResult): string =>
  [
    `tokens: ${result.tokens ?? 'n/a'}  latency: ${result.latencyMs} ms`,
    `trace: ${result.traceId}  participant: ${result.participantId}  profile: ${result.profileSource}`,
    'saved .talk-picker/last-plan.json',
    ...(result.profileSaved
      ? [
          `saved ${result.profileSource} as .talk-picker/${PROFILE_FILE} (you had none): a plain \`pnpm plan\` uses it from now on`,
        ]
      : []),
  ].join('\n');
