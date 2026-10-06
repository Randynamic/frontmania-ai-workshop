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
export const PROFILE_INSTRUCTIONS = `You turn a CV, or a typed list of skills, into a conference-attendee profile.
The profile picks afternoon talks for this person; it is not a summary of the CV.

Extract exactly these fields:
- role: what the person does, in one short phrase (under 80 characters), without any employer or product name
  (for example "front-end architect at a logistics scale-up", "junior Angular developer in government").
- seniority: one of junior, medior, senior, lead.
  When years of experience are stated: under 2 years is junior, 2 to 5 is medior, 5 to 10 is senior,
  more than 10 is senior unless the person owns a team, a platform or an architecture, which is lead.
  When years are not stated: owning a team or the architecture is lead, leading projects or mentoring
  others is senior, a first job or a study is junior, everything else is medior. In doubt, pick the lower level.
- stack: up to 10 technologies the person actually uses, most recent first. Skip tools mentioned once in passing.
- interests: up to 8 topics the person would want to see a talk about, taken from what they build and what they say they want to learn.
- avoid: up to 5 topics the person does not want; only what the text says or clearly implies, never a guess.

Rules:
- Never output names, employers, clients, cities, email addresses, phone numbers, links or anything else that identifies the person.
- Vague or short input gives shorter arrays and a lower seniority, never invented details.
- Write every value in English, even when the input is Dutch. Keep each array item short (one to four words).
- Answer only with the requested structure.`;

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
