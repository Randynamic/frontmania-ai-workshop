import { describe, expect, test } from 'vitest';
import { loadPersonas } from '../../../data/personas.js';
import { loadProgram, talksForSlot } from '../../../data/program.js';
import { Plan } from '../../../schemas/plan.js';
import type { SlotRanking } from '../../../schemas/slot-ranking.js';
import { createTipAgent } from '../../agents/tip.js';
import { createMastra } from '../../index.js';
import { createMockTaskModel, type MockPrompt } from '../../model.js';
import { promptText, routedMockReply } from '../../mock-replies.js';
import type { ArchiveHit } from '../../tools/search-archive.js';
import {
  generateTip,
  serializeCandidates,
  serializeRanking,
  tipStep,
  topTalkFor,
  writeTip,
} from './tip.js';

const { program } = loadProgram(undefined, () => undefined);
const profile = loadPersonas()[1]!.profile;
const rankingFor = (slot: SlotRanking['slot']): SlotRanking => ({
  slot,
  ranking: talksForSlot(program, slot).map((t) => t.id),
  reason: 'closest to the interests',
  confidence: 0.7,
});
const hit = (id: string, title: string): ArchiveHit => ({
  id,
  year: 2025,
  title,
  speakers: ['A'],
  videoUrl: null,
  text: `${title}\nA\n\nabstract`,
  score: 0.5,
});
const hits = [hit('fm25-a', 'Design tokens'), hit('fm25-b', 'Human in the loop agents')];

const mastraWith = (reply: (prompt: MockPrompt) => string, seen: string[] = []) =>
  createMastra(
    { MODEL_MODE: 'mock' },
    {
      agents: {
        tip: createTipAgent(
          createMockTaskModel((prompt) => {
            seen.push(promptText(prompt));
            return reply(prompt);
          }),
        ),
      },
    },
  );

describe('writeTip', () => {
  test("renders profile, ranking and candidates and returns the model's tip", async () => {
    // Arrange
    const seen: string[] = [];
    const mastra = mastraWith(
      () => JSON.stringify({ slot: '14:15', archiveTalkId: 'fm25-b', why: 'same theme' }),
      seen,
    );

    // Act
    const tip = await writeTip(rankingFor('14:15'), hits, profile, { mastra });

    // Assert
    expect(tip).toEqual({ slot: '14:15', archiveTalkId: 'fm25-b', why: 'same theme' });
    const prompt = seen[0]!;
    expect(prompt).toContain('Top pick: [fm26-1227996] Human-in-the-Loop');
    expect(prompt).toContain('- [fm25-a] 2025 Design tokens — A: Design tokens A abstract');
    expect(prompt).toContain(JSON.stringify(profile));
  });

  test('no candidates means no tip and no model call', async () => {
    const seen: string[] = [];
    const tip = await writeTip(rankingFor('15:30'), [], profile, {
      mastra: mastraWith(() => '', seen),
    });
    expect(tip).toBeUndefined();
    expect(seen).toEqual([]);
  });

  test('a tip outside the candidates or a ranking with a foreign id is a clear error', async () => {
    const mastra = mastraWith(() =>
      JSON.stringify({ slot: '14:15', archiveTalkId: 'fm25-zzz', why: 'made up' }),
    );
    await expect(writeTip(rankingFor('14:15'), hits, profile, { mastra })).rejects.toThrow(
      'not one of the 2 candidates',
    );
    expect(() => topTalkFor({ ...rankingFor('14:15'), ranking: ['fm26-1141925'] })).toThrow(
      'not a talk in that slot',
    );
    expect(() => topTalkFor({ ...rankingFor('14:15'), ranking: ['fm26-nope'] })).toThrow(
      'ranker returned fm26-nope',
    );
  });

  test("generateTip reports tokens and latency; the slot is forced to the ranking's", async () => {
    let tick = 0;
    const mastra = mastraWith(() =>
      JSON.stringify({ slot: '16:30', archiveTalkId: 'fm25-a', why: 'w' }),
    );
    const generated = await generateTip(
      rankingFor('14:15'),
      hits,
      profile,
      { mastra },
      () => (tick += 100),
    );
    expect(generated.tip.slot).toBe('14:15');
    expect(generated.tokens).toBeGreaterThan(0);
    expect(generated.latencyMs).toBe(100);
  });

  test('serializers are one line per candidate and a fixed ranking block', () => {
    const top = talksForSlot(program, '14:15')[0]!;
    expect(serializeRanking(rankingFor('14:15'), top).split('\n')).toHaveLength(4);
    expect(serializeCandidates(hits).split('\n')).toHaveLength(2);
  });
});

describe('tipStep', () => {
  test('retrieves once per ranking with the top title in the query and joins into a Plan', async () => {
    // Arrange
    const seen: string[] = [];
    const mastra = mastraWith(routedMockReply, seen);
    const rankings = [rankingFor('14:15'), rankingFor('15:30'), rankingFor('16:30')];

    // Act
    const plan = Plan.parse(
      await tipStep.execute({
        inputData: rankings,
        mastra,
        getInitData: () => ({ profile }),
      } as never),
    );

    // Assert
    expect(plan.rankings).toEqual(rankings);
    expect(plan.tips).toHaveLength(3);
    expect(plan.tips.map((t) => t.slot)).toEqual(['14:15', '15:30', '16:30']);
    expect(seen).toHaveLength(3);
    // Each tip prompt carries the archive candidates found for that slot's top talk.
    for (const prompt of seen) expect(prompt).toMatch(/- \[fm25-[a-z0-9-]+\] 2025 /);
  });
});
