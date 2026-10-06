import { PROFILE_INSTRUCTIONS } from '../mastra/agents/profile.js';
import { RANKER_PROMPT_MARKER, TIP_PROMPT_MARKER } from '../mastra/mock-replies.js';
import type { PromptName, PromptVersion } from './load.js';

/**
 * The seed text of the three registry prompts, `{{variable}}` syntax.
 *
 * This file is the canonical copy: `optimize/seed_prompts.py` (final
 * branch, D-1) registers exactly these texts in the MLflow prompt registry
 * under alias `production`, and `optimize/prompts/*.txt` must be
 * byte-identical (checked by a unit test there). In MODEL_MODE=mock the
 * prompt loader returns them directly, so the static checks need no backend.
 * GEPA rewrites `ranker` on the day; the other two stay as seeded.
 */
export const SEED_VERSION = 'seed';

export const RANKER_SEED = `You pick afternoon conference talks for one attendee.

Attendee profile (JSON):
{{profile}}

Slot: {{slot}}

Talks in this slot, one per line as [id] title — speakers (room, minutes): abstract
{{talks}}

${RANKER_PROMPT_MARKER} from best to worst fit for this attendee. Interests and stack are positive signals, the avoid list is a hard negative, seniority sets the depth they want. Return every id of this slot exactly once, in order; one reason of at most 280 characters for the top choice; a confidence between 0 and 1.`;

export const TIP_SEED = `You recommend one recorded talk from an earlier edition of the same conference as preparation for an afternoon slot.

Attendee profile (JSON):
{{profile}}

The ranked slot:
{{ranking}}

${TIP_PROMPT_MARKER}, one per line as [id] year title — speakers: abstract
{{candidates}}

Pick the one candidate that best prepares this attendee for the top pick, or is the best alternative if they skip it. Return the slot, the candidate id and why in at most 280 characters.`;

export const SEED_PROMPTS: Readonly<Record<PromptName, string>> = {
  profile: PROFILE_INSTRUCTIONS,
  ranker: RANKER_SEED,
  tip: TIP_SEED,
};

/** What loadPrompt returns in mock mode: the seed text as if alias production pointed at it. */
export const seedPromptVersion = (name: PromptName): PromptVersion => ({
  name,
  alias: 'production',
  version: SEED_VERSION,
  template: SEED_PROMPTS[name],
});
