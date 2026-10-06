import { describe, expect, test } from 'vitest';
import { renderPrompt, serializeProfile, serializeTalks } from '../prompts/render.js';
import { RANKER_SEED, TIP_SEED } from '../prompts/seed.js';
import { Profile } from '../schemas/profile.js';
import { SlotRanking } from '../schemas/slot-ranking.js';
import { Tip } from '../schemas/tip.js';
import { loadProgram, talksForSlot } from '../data/program.js';
import {
  MOCK_CONFIDENCE,
  profileReply,
  promptText,
  rankingReply,
  routedMockReply,
  tipReply,
} from './mock-replies.js';
import type { MockPrompt } from './model.js';

const { program } = loadProgram(undefined, () => undefined);
const talks = talksForSlot(program, '15:30');
const profile = {
  role: 'front-end developer',
  seniority: 'medior' as const,
  stack: ['TypeScript'],
  interests: ['CSS', 'state machines'],
  avoid: ['IoT'],
};

const asPrompt = (text: string): MockPrompt => [
  { role: 'system', content: 'instructions' },
  { role: 'user', content: [{ type: 'text', text }] },
];

describe('rankingReply', () => {
  test('returns every id of the slot once, interests first, avoid last', () => {
    // Arrange
    const text = renderPrompt(RANKER_SEED, {
      profile: serializeProfile(profile),
      slot: '15:30',
      talks: serializeTalks(talks),
    });

    // Act
    const ranking = SlotRanking.parse(JSON.parse(rankingReply(text)));

    // Assert
    expect(ranking.slot).toBe('15:30');
    expect([...ranking.ranking].sort()).toEqual(talks.map((t) => t.id).sort());
    expect(ranking.ranking[0]).toBe('fm26-1196635'); // "CSS State Machine"
    expect(ranking.ranking.at(-1)).toBe('fm26-1145006'); // the IoT talk
    expect(ranking.confidence).toBe(MOCK_CONFIDENCE);
  });

  test('a prompt without talks still validates', () => {
    const ranking = SlotRanking.safeParse(JSON.parse(rankingReply('Slot: 16:30\nnothing')));
    expect(ranking.success).toBe(false); // empty ranking is invalid by schema, as it should be
    expect(JSON.parse(rankingReply('no slot at all'))).toMatchObject({ slot: '14:15' });
  });
});

describe('tipReply', () => {
  test('picks the candidate closest to the top pick', () => {
    const text = renderPrompt(TIP_SEED, {
      profile: serializeProfile(profile),
      ranking: 'Slot: 14:15\nTop pick: [fm26-1] Accessible components\nReason: r\nConfidence: 0.5',
      candidates:
        '- [fm25-a] 2025 Fast builds — X: about bundlers\n- [fm25-b] 2025 Accessible components in practice — Y: a11y',
    });
    const tip = Tip.parse(JSON.parse(tipReply(text)));
    expect(tip).toMatchObject({ slot: '14:15', archiveTalkId: 'fm25-b' });
  });
});

describe('routedMockReply', () => {
  test('routes a tip prompt, a ranker prompt and anything else', () => {
    const rankerText = renderPrompt(RANKER_SEED, {
      profile: serializeProfile(profile),
      slot: '14:15',
      talks: serializeTalks(talksForSlot(program, '14:15')),
    });
    const tipText = renderPrompt(TIP_SEED, {
      profile: '{}',
      ranking: 'Slot: 16:30\nTop pick: [fm26-1] t',
      candidates: '- [fm25-z] 2025 t — s: a',
    });
    expect(SlotRanking.safeParse(JSON.parse(routedMockReply(asPrompt(rankerText)))).success).toBe(
      true,
    );
    expect(Tip.safeParse(JSON.parse(routedMockReply(asPrompt(tipText)))).success).toBe(true);
    expect(Profile.safeParse(JSON.parse(routedMockReply(asPrompt('a CV'))))).toMatchObject({
      success: true,
    });
    expect(routedMockReply(asPrompt('a CV'))).toBe(profileReply());
  });

  test('promptText joins string and part contents', () => {
    expect(promptText(asPrompt('hello'))).toBe('instructions\nhello');
  });
});
