import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Mastra } from '@mastra/core';
import { backendConfigFrom, type BackendConfig } from '../../src/backend/client.js';
import { fetchParticipantId } from '../../src/backend/whoami.js';
import { REPO_ROOT } from '../../src/data/paths.js';
import { loadArchiveTalks, toArchiveRow } from '../../src/data/archive.js';
import { talksForSlot } from '../../src/data/program.js';
import { modelModeFrom } from '../../src/mastra/model.js';
import { programOnce } from '../../src/mastra/workflows/steps/expand-slots.js';
import { generateTip } from '../../src/mastra/workflows/steps/tip.js';
import {
  searchArchive,
  searchArchiveHits,
  type ArchiveHit,
} from '../../src/mastra/tools/search-archive.js';
import { readLastRun, registerRun, RUN_DIR, writeLastRun } from '../../src/run/record.js';
import { Plan } from '../../src/schemas/plan.js';
import { Profile } from '../../src/schemas/profile.js';
import type { SlotRanking } from '../../src/schemas/slot-ranking.js';
import { parseArgs } from '../lib/args.js';
import { readProfileFile } from '../plan/run.js';
import { MOCK_PARTICIPANT_ID, PROFILE_FILE } from '../profile/run.js';

/**
 * pnpm compare [--profile <json>]
 *
 * The in-prompt versus retrieval decision with numbers: the tip prompt for
 * slot 14:15 once with every archive abstract as candidates (variant A)
 * and once with the top-5 from searchArchive (variant B). Two model calls
 * plus one embedding. Prints `variant | tokens | latency` for both; writes
 * `.talk-picker/last-compare.json`; registers both traces as kind `compare`.
 * The profile is the one of the last `pnpm plan` (so a plan run with
 * `--profile` needs no second flag), else `--profile`, else
 * `.talk-picker/profile.json`; `--profile` always wins when given.
 */
export const COMPARE_USAGE =
  'usage: pnpm compare  |  pnpm compare --profile data/cvs/profiles/<persona>.json';
export const COMPARE_SLOT = '14:15' as const;
export const RETRIEVAL_TOP_K = 5;
export const VARIANTS = ['in-prompt', 'retrieval'] as const;
export type Variant = (typeof VARIANTS)[number];
const FALLBACK_CONFIDENCE = 0.5;

export interface CompareRunDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly mastra: Mastra;
  readonly runDir?: string;
  readonly backend?: BackendConfig;
  readonly now?: () => number;
  /** Hits for variant B; defaults to the searchArchive tool. */
  readonly retrieve?: (queryText: string) => Promise<readonly ArchiveHit[]>;
  /**
   * The MLflow trace id of the model call just made (`tr-` + OTel id).
   * Agent runs outside a workflow are their own traces and generateTip
   * returns no id, so the CLI records root spans with an exporter and
   * hands them out here, one per variant.
   */
  readonly nextTraceId?: () => string | undefined;
}

export interface VariantResult {
  readonly variant: Variant;
  readonly candidates: number;
  readonly tokens: number | null;
  readonly latencyMs: number;
  readonly archiveTalkId: string;
  readonly traceId: string;
}

export interface CompareRunResult {
  readonly participantId: string;
  readonly profileSource: string;
  readonly rankingSource: string;
  readonly variants: readonly VariantResult[];
}

const lastPlanRecord = (runDir: string): Record<string, unknown> | undefined => {
  try {
    return readLastRun('plan', runDir);
  } catch {
    return undefined;
  }
};

/** Where the profile comes from: --profile, else the last `pnpm plan`, else the last `pnpm run profile`. */
export const resolveCompareProfile = (
  argv: readonly string[],
  runDir: string,
): { readonly profile: Profile; readonly source: string } => {
  const fromFlag = parseArgs(argv).flags.profile;
  if (typeof fromFlag === 'string') {
    const hint = `cannot read ${fromFlag}; persona profiles live in data/cvs/profiles/\n${COMPARE_USAGE}`;
    return { profile: readProfileFile(resolve(REPO_ROOT, fromFlag), hint), source: fromFlag };
  }
  const fromPlan = Profile.safeParse(lastPlanRecord(runDir)?.['profile']);
  if (fromPlan.success) return { profile: fromPlan.data, source: 'last pnpm plan' };
  const path = resolve(runDir, PROFILE_FILE);
  if (!existsSync(path)) {
    throw new Error(
      'no profile yet: run `pnpm run profile --cv <file>` first, then `pnpm plan`; or `pnpm compare --profile data/cvs/profiles/<persona>.json`',
    );
  }
  return {
    profile: Profile.parse(JSON.parse(readFileSync(path, 'utf8'))),
    source: `.talk-picker/${PROFILE_FILE}`,
  };
};

/** The 14:15 ranking of the last `pnpm plan`, or programme order with a note when there is none. */
export const rankingForCompare = (
  runDir: string,
): { readonly ranking: SlotRanking; readonly source: string } => {
  const last = lastPlanRecord(runDir);
  const plan = last ? Plan.safeParse(last['plan']) : undefined;
  const fromPlan = plan?.success
    ? plan.data.rankings.find((r) => r.slot === COMPARE_SLOT)
    : undefined;
  if (fromPlan) return { ranking: fromPlan, source: 'last pnpm plan' };
  return {
    ranking: {
      slot: COMPARE_SLOT,
      ranking: talksForSlot(programOnce().program, COMPARE_SLOT).map((t) => t.id),
      reason: 'programme order (run pnpm plan first for a real ranking)',
      confidence: FALLBACK_CONFIDENCE,
    },
    source: 'programme order (no pnpm plan yet)',
  };
};

/** Every archive abstract, as the tip prompt would carry it in variant A. */
export const allArchiveHits = (): readonly ArchiveHit[] =>
  loadArchiveTalks().talks.map((talk) => ({ ...toArchiveRow(talk), score: 1 }));

const defaultRetrieve = async (queryText: string): Promise<readonly ArchiveHit[]> =>
  searchArchiveHits(await searchArchive.execute({ queryText, topK: RETRIEVAL_TOP_K }));

export const runCompare = async (
  argv: readonly string[],
  deps: CompareRunDeps,
): Promise<CompareRunResult> => {
  const now = deps.now ?? Date.now;
  const runDir = deps.runDir ?? RUN_DIR;
  const isMock = modelModeFrom(deps.env) === 'mock';
  const { profile, source: profileSource } = resolveCompareProfile(argv, runDir);
  const backend = isMock ? undefined : (deps.backend ?? backendConfigFrom(deps.env));
  const participantId = backend ? await fetchParticipantId(backend) : MOCK_PARTICIPANT_ID;
  const { ranking, source } = rankingForCompare(runDir);
  const topTitle = talksForSlot(programOnce().program, COMPARE_SLOT).find(
    (t) => t.id === ranking.ranking[0],
  )?.title;
  const query = `${topTitle ?? ''} ${profile.interests.join(' ')}`.trim();
  const retrieve = deps.retrieve ?? defaultRetrieve;

  const runVariant = async (
    variant: Variant,
    hits: readonly ArchiveHit[],
  ): Promise<VariantResult> => {
    const generated = await generateTip(ranking, hits, profile, { mastra: deps.mastra }, now);
    const traceId = deps.nextTraceId?.() ?? `tr-compare-${variant}-unrecorded`;
    return {
      variant,
      candidates: hits.length,
      tokens: generated.tokens,
      latencyMs: generated.latencyMs,
      archiveTalkId: generated.tip.archiveTalkId,
      traceId,
    };
  };

  const inPrompt = await runVariant('in-prompt', allArchiveHits());
  const retrieval = await runVariant('retrieval', await retrieve(query));
  await deps.mastra.shutdown();
  const variants = [inPrompt, retrieval];

  writeLastRun(
    'compare',
    {
      traceId: inPrompt.traceId,
      tokens:
        inPrompt.tokens !== null && retrieval.tokens !== null
          ? inPrompt.tokens + retrieval.tokens
          : null,
      latencyMs: inPrompt.latencyMs + retrieval.latencyMs,
      participantId,
      variants,
    },
    runDir,
  );
  if (backend) {
    for (const variant of variants)
      await registerRun(variant.traceId, 'compare', { config: backend });
  }
  return { participantId, profileSource, rankingSource: source, variants };
};

const VARIANT_WIDTH = 10;
const NUMBER_WIDTH = 8;

export const formatCompare = (result: CompareRunResult): string => {
  const header = `${'variant'.padEnd(VARIANT_WIDTH)} | ${'candidates'.padStart(NUMBER_WIDTH + 2)} | ${'tokens'.padStart(NUMBER_WIDTH)} | ${'latency'.padStart(NUMBER_WIDTH)} | tip`;
  const rows = result.variants.map(
    (v) =>
      `${v.variant.padEnd(VARIANT_WIDTH)} | ${String(v.candidates).padStart(NUMBER_WIDTH + 2)} | ${String(v.tokens ?? 'n/a').padStart(NUMBER_WIDTH)} | ${`${v.latencyMs} ms`.padStart(NUMBER_WIDTH)} | ${v.archiveTalkId}`,
  );
  return [
    `tip prompt for ${COMPARE_SLOT}, ranking from ${result.rankingSource}, profile from ${result.profileSource}`,
    header,
    ...rows,
    `participant: ${result.participantId}; saved .talk-picker/last-compare.json`,
  ].join('\n');
};
