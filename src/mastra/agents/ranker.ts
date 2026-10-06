import { Agent } from '@mastra/core/agent';
import { taskModel } from '../model.js';

/**
 * The ranker agent (exercise 2, step 1 calls it). Its instructions are
 * fixed and short on purpose: the ranking prompt itself comes from the
 * MLflow prompt registry per call (`loadPrompt('ranker')`), so GEPA can
 * rewrite it and the reveal can move the `production` alias without a
 * code change. Same Agent API as the profile agent (verified 26 Sep 2026
 * against @mastra/core 1.71.0, agent/types.d.ts).
 */
export const RANKER_INSTRUCTIONS =
  'You rank conference talks for one person. Answer only in the requested structure. Keep the reason to one sentence of at most 30 words.';
export const RANKER_AGENT_ID = 'ranker-agent';

type RankerAgentModel = ConstructorParameters<typeof Agent>[0]['model'];

export const createRankerAgent = (model: RankerAgentModel) =>
  new Agent({
    id: RANKER_AGENT_ID,
    name: 'ranker',
    instructions: RANKER_INSTRUCTIONS,
    model,
  });

export const rankerAgent = createRankerAgent(() => taskModel());
