import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Mastra } from '@mastra/core';
import { REPO_ROOT } from '../../src/data/paths.js';
import { talksForSlot } from '../../src/data/program.js';
import { programOnce } from '../../src/mastra/workflows/steps/expand-slots.js';
import { loadPrompt, type PromptName, type PromptVersion } from '../../src/prompts/load.js';
import { seedPromptVersion } from '../../src/prompts/seed.js';
import { renderPrompt, serializeProfile, serializeTalks } from '../../src/prompts/render.js';
import { modelModeFrom } from '../../src/mastra/model.js';
import { Profile } from '../../src/schemas/profile.js';
import { SlotRanking } from '../../src/schemas/slot-ranking.js';
import { Slot } from '../../src/schemas/talk.js';
import { parseArgs } from '../lib/args.js';

/**
 * pnpm rank-once --profile <json> --slot <slot> [--render-only]
 *
 * The contract-test partner of optimize/rank_slot.py (final branch): renders
 * the production ranker prompt exactly as rankSlot does and, unless
 * --render-only, runs one ranking. Same template, same serialisers, same
 * agent, so the Python twin can be compared byte for byte.
 */
export const USAGE =
  'usage: pnpm rank-once --profile data/cvs/profiles/<persona>.json --slot 14:15|15:30|16:30 [--render-only]';

export interface RankOnceArgs {
  readonly profile: Profile;
  readonly slot: Slot;
  readonly renderOnly: boolean;
}

export const parseRankOnceArgs = (argv: readonly string[]): RankOnceArgs => {
  const args = parseArgs(argv);
  const profilePath = args.flags.profile;
  const slotFlag = args.flags.slot;
  if (typeof profilePath !== 'string' || typeof slotFlag !== 'string') throw new Error(USAGE);
  const slot = Slot.safeParse(slotFlag);
  if (!slot.success) throw new Error(`--slot must be one of 14:15, 15:30, 16:30\n${USAGE}`);
  const profile = Profile.safeParse(
    JSON.parse(readFileSync(resolve(REPO_ROOT, profilePath), 'utf8')),
  );
  if (!profile.success) throw new Error(`${profilePath} is not a valid Profile`);
  return { profile: profile.data, slot: slot.data, renderOnly: args.flags['render-only'] === true };
};

export type PromptSource = (name: PromptName) => Promise<PromptVersion>;

/**
 * Where --render-only reads the ranker template. It makes no model call, so
 * it needs no key: without WORKSHOP_BACKEND_URL and PROXY_API_KEY (or in
 * mock mode) it renders the seed template, and `note` says so on stderr;
 * with both it reads the registry's production version, as rankSlot does.
 */
export const renderPromptSource = (
  env: Readonly<Record<string, string | undefined>>,
): { readonly load: PromptSource; readonly note?: string } => {
  if (modelModeFrom(env) === 'mock') return { load: async (name) => seedPromptVersion(name) };
  const hasBackend = Boolean(env.WORKSHOP_BACKEND_URL?.trim() && env.PROXY_API_KEY?.trim());
  if (hasBackend) return { load: loadPrompt };
  return {
    load: async (name) => seedPromptVersion(name),
    note: 'no PROXY_API_KEY or WORKSHOP_BACKEND_URL: rendered the seed ranker template (src/prompts/seed.ts), not the registry production version',
  };
};

/** The rendered production prompt for one persona and one slot (no model call). */
export const renderRankerPrompt = async (
  profile: Profile,
  slot: Slot,
  load: PromptSource = loadPrompt,
): Promise<string> => {
  const { template } = await load('ranker');
  return renderPrompt(template, {
    profile: serializeProfile(profile),
    slot,
    talks: serializeTalks(talksForSlot(programOnce().program, slot)),
  });
};

export const rankOnce = async (
  profile: Profile,
  slot: Slot,
  mastra: Mastra,
): Promise<SlotRanking> => {
  const prompt = await renderRankerPrompt(profile, slot);
  const result = await mastra.getAgent('ranker').generate(prompt, {
    structuredOutput: { schema: SlotRanking, errorStrategy: 'strict' },
    tracingOptions: { metadata: { kind: 'rank-once', slot } },
  });
  return result.object;
};
