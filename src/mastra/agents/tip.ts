import { Agent } from '@mastra/core/agent';
import { taskModel } from '../model.js';

/**
 * The tip agent: given a ranked slot and a handful of archive candidates
 * (from searchArchive, exercise 2 step 3) it picks one earlier-edition talk
 * to watch. The prompt text is the registry prompt `tip`.
 */
export const TIP_INSTRUCTIONS =
  'You recommend one recorded talk from an earlier edition as preparation for a conference slot. Answer only in the requested structure. Keep why to one sentence of at most 30 words.';
export const TIP_AGENT_ID = 'tip-agent';

type TipAgentModel = ConstructorParameters<typeof Agent>[0]['model'];

export const createTipAgent = (model: TipAgentModel) =>
  new Agent({
    id: TIP_AGENT_ID,
    name: 'tip',
    instructions: TIP_INSTRUCTIONS,
    model,
  });

export const tipAgent = createTipAgent(() => taskModel());
