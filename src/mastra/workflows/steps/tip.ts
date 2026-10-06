import type { Mastra } from '@mastra/core';
import type { TracingContext } from '@mastra/core/observability';
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { talkById } from '../../../data/program.js';
import { loadPrompt } from '../../../prompts/load.js';
import { oneLine, renderPrompt, serializeProfile } from '../../../prompts/render.js';
import { Plan } from '../../../schemas/plan.js';
import type { Profile } from '../../../schemas/profile.js';
import { SlotRanking } from '../../../schemas/slot-ranking.js';
import type { Talk } from '../../../schemas/talk.js';
import { Tip } from '../../../schemas/tip.js';
import { searchArchive, searchArchiveHits, type ArchiveHit } from '../../tools/search-archive.js';
import { programOnce } from './expand-slots.js';

/**
 * Step 3 of the plan workflow: one tip per slot from the archive.
 *
 * Exercise 2, step 3 is the retrieval line inside `execute`: ask
 * searchArchive for the archive talks closest to the top-ranked talk and
 * the profile's interests, and hand the hits to `writeTip`. Everything
 * else here is given: the loop, the top-talk lookup, the tip prompt and
 * the join into a Plan.
 */
export interface TipContext {
  readonly mastra: Mastra;
  readonly tracingContext?: TracingContext | undefined;
}

export interface TipGeneration {
  readonly tip: Tip;
  readonly tokens: number | null;
  readonly latencyMs: number;
}

/** The talk the ranker put first; a ranking that names an unknown talk is a bug worth a clear message. */
export const topTalkFor = (ranking: SlotRanking): Talk => {
  const id = ranking.ranking[0];
  const talk = id ? talkById(programOnce().program, id) : undefined;
  if (!talk || talk.slot !== ranking.slot) {
    throw new Error(
      `ranker returned ${id ?? 'nothing'} for slot ${ranking.slot}, which is not a talk in that slot; run pnpm plan again`,
    );
  }
  return talk;
};

/** What the tip prompt sees of the ranking: the slot, the top pick and why. */
export const serializeRanking = (ranking: SlotRanking, topTalk: Talk): string =>
  [
    `Slot: ${ranking.slot}`,
    `Top pick: [${topTalk.id}] ${topTalk.title} — ${topTalk.speakers.join(', ')}`,
    `Reason: ${ranking.reason}`,
    `Confidence: ${ranking.confidence}`,
  ].join('\n');

/** One line per archive candidate, in hit order. */
export const serializeCandidates = (hits: readonly ArchiveHit[]): string =>
  hits
    .map(
      (hit) =>
        `- [${hit.id}] ${hit.year} ${hit.title} — ${hit.speakers.join(', ')}: ${oneLine(hit.text)}`,
    )
    .join('\n');

/** The tip model call with its numbers; `pnpm compare` reads tokens and latency from here. */
export const generateTip = async (
  ranking: SlotRanking,
  hits: readonly ArchiveHit[],
  profile: Profile,
  context: TipContext,
  now: () => number = Date.now,
): Promise<TipGeneration> => {
  const topTalk = topTalkFor(ranking);
  const { template } = await loadPrompt('tip');
  const prompt = renderPrompt(template, {
    profile: serializeProfile(profile),
    ranking: serializeRanking(ranking, topTalk),
    candidates: serializeCandidates(hits),
  });
  const started = now();
  const result = await context.mastra.getAgent('tip').generate(prompt, {
    structuredOutput: { schema: Tip, errorStrategy: 'strict' },
    tracingContext: context.tracingContext,
  });
  const tip = result.object;
  if (!hits.some((hit) => hit.id === tip.archiveTalkId)) {
    throw new Error(
      `tip for ${ranking.slot} names ${tip.archiveTalkId}, which is not one of the ${hits.length} candidates; run pnpm plan again`,
    );
  }
  return {
    tip: { ...tip, slot: ranking.slot },
    tokens: result.usage.totalTokens ?? null,
    latencyMs: now() - started,
  };
};

/** Given: one tip from the candidates, or none when there are no candidates (the start-branch state). */
export const writeTip = async (
  ranking: SlotRanking,
  hits: readonly ArchiveHit[],
  profile: Profile,
  context: TipContext,
): Promise<Tip | undefined> =>
  hits.length === 0 ? undefined : (await generateTip(ranking, hits, profile, context)).tip;

export const tipStep = createStep({
  id: 'tip',
  inputSchema: z.array(SlotRanking),
  outputSchema: Plan,
  execute: async ({ inputData, mastra, tracingContext, getInitData }) => {
    const { profile } = getInitData<{ profile: Profile }>();
    const tips: Tip[] = [];
    for (const ranking of inputData) {
      const topTalk = topTalkFor(ranking);
      const hits = searchArchiveHits(
        await searchArchive.execute(
          { queryText: `${topTalk.title} ${profile.interests.join(' ')}`, topK: 5 },
          { mastra },
        ),
      );
      const tip = await writeTip(ranking, hits, profile, { mastra, tracingContext });
      if (tip) tips.push(tip);
    }
    return { rankings: inputData, tips };
  },
});
