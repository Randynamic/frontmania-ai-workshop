import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { loadPrompt } from '../prompts/load.js';
import { renderPrompt, serializeProfile, serializeTalks } from '../prompts/render.js';
import { Plan, PlanInput, SlotInput } from '../schemas/plan.js';
import type { Profile } from '../schemas/profile.js';
import { SlotRanking } from '../schemas/slot-ranking.js';
import type { Tip } from '../schemas/tip.js';
import { expandSlots } from '../mastra/workflows/steps/expand-slots.js';
import { topTalkFor, writeTip } from '../mastra/workflows/steps/tip.js';
import { searchArchive, searchArchiveHits } from '../mastra/tools/search-archive.js';

/**
 * Test fixture: the reference plan workflow the harness tests (the check
 * script's own tests, the `pnpm plan` tests) run against, so those suites
 * stay green on every branch whatever state the exercise files are in.
 * The exercise itself is judged by `pnpm check:02` on the real files.
 */
const solvedRankSlot = createStep({
  id: 'rankSlot',
  inputSchema: SlotInput,
  outputSchema: SlotRanking,
  execute: async ({ inputData, mastra, tracingContext }) => {
    const { profile, slot, talks } = inputData;
    const { template } = await loadPrompt('ranker');
    const prompt = renderPrompt(template, {
      profile: serializeProfile(profile),
      slot,
      talks: serializeTalks(talks),
    });
    const result = await mastra.getAgent('ranker').generate(prompt, {
      structuredOutput: { schema: SlotRanking, errorStrategy: 'strict' },
      tracingContext,
    });
    return result.object;
  },
});

const solvedTipStep = createStep({
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

export const SOLVED_RANK_CONCURRENCY = 3;

export const solvedPlanWorkflow = createWorkflow({
  id: 'plan',
  inputSchema: PlanInput,
  outputSchema: Plan,
})
  .then(expandSlots)
  .foreach(solvedRankSlot, { concurrency: SOLVED_RANK_CONCURRENCY })
  .then(solvedTipStep)
  .commit();
