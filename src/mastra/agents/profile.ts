import { Agent } from '@mastra/core/agent';
import { taskModel } from '../model.js';

/**
 * Exercise 1, step 2: the instructions the profile agent runs with. They
 * are the whole "program": what to extract, how to grade seniority when the
 * CV does not say, and what must never appear in the output.
 *
 * Verified 26 Sep 2026 against @mastra/core 1.71.0: `new Agent({ id, name,
 * instructions, model })` (agent/types.d.ts, AgentConfigBase) and
 * `agent.generate(text, { structuredOutput: { schema, errorStrategy },
 * tracingOptions: { metadata } })` (agent/agent.types.d.ts). `model` may be
 * a function, so the proxy client is created on first use, not on import.
 */
// TODO(exercise 01, step 2): write the instructions. Cover: what to extract (role,
// seniority on the four-level scale with a rule for when years are not stated,
// stack, interests, topics to avoid); never output names, employers or contact
// details; vague input yields shorter arrays and a lower seniority, not guesses.
export const PROFILE_INSTRUCTIONS = `Extract a profile from the text.`;

export const PROFILE_AGENT_ID = 'profile-agent';

type ProfileAgentModel = ConstructorParameters<typeof Agent>[0]['model'];

/** Builds the agent with a given model; tests pass a scripted mock, the app passes the proxy model. */
export const createProfileAgent = (model: ProfileAgentModel) =>
  new Agent({
    id: PROFILE_AGENT_ID,
    name: 'profile',
    instructions: PROFILE_INSTRUCTIONS,
    model,
  });

export const profileAgent = createProfileAgent(() => taskModel());
