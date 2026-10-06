import type { Mastra } from '@mastra/core';
import type { ObservabilityContext } from '@mastra/core/observability';
import { createStep } from '@mastra/core/workflows';
import { loadPrompt } from '../../../prompts/load.js';
import { renderPrompt, serializeProfile, serializeTalks } from '../../../prompts/render.js';
import { SlotInput } from '../../../schemas/plan.js';
import { SlotRanking } from '../../../schemas/slot-ranking.js';
import { keepToSlot } from './slot-guard.js';

/** What rankSlot hands to `askRanker`: the step's own execute parameters. */
export type AskRankerParams = Partial<ObservabilityContext> & {
  readonly inputData: SlotInput;
  readonly mastra: Mastra;
};

/**
 * Exercise 2, step 1: rank the talks of one slot for one profile.
 *
 * The prompt text is the registry prompt `ranker` (alias `production`),
 * rendered with the profile, the slot and the slot's talks; the ranker
 * agent answers in the SlotRanking shape (structured output, strict). The
 * step's `tracingContext` goes into `generate` so the model call nests
 * under the workflow trace instead of starting its own.
 *
 * Verified 26 Sep 2026 against @mastra/core 1.71.0: `agent.generate(text,
 * { structuredOutput: { schema, errorStrategy }, tracingContext })`
 * (agent/agent.types.d.ts, AgentExecutionOptionsBase & Partial<ObservabilityContext>);
 * step execute params are `Partial<ObservabilityContext> & { mastra: Mastra; inputData }`
 * (workflows/step.d.ts, ExecuteFunctionParams).
 */
export const askRanker = async ({
  inputData,
  mastra,
  tracingContext,
}: AskRankerParams): Promise<SlotRanking> => {
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
};

/** Given: the step around `askRanker`; the answer keeps to the slot it was asked about. */
export const rankSlot = createStep({
  id: 'rankSlot',
  inputSchema: SlotInput,
  outputSchema: SlotRanking,
  execute: async (params) => keepToSlot(await askRanker(params), params.inputData),
});
