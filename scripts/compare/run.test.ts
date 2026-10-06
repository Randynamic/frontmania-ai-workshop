import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { backendConfigFrom } from '../../src/backend/client.js';
import { loadPersonas } from '../../src/data/personas.js';
import { clearCurrentRun } from '../../src/feedback/current-run.js';
import { AGENTS, createMastra } from '../../src/mastra/index.js';
import { readLastRun, writeLastRun } from '../../src/run/record.js';
import {
  allArchiveHits,
  COMPARE_SLOT,
  formatCompare,
  rankingForCompare,
  resolveCompareProfile,
  RETRIEVAL_TOP_K,
  runCompare,
} from './run.js';

const persona = loadPersonas()[1]!;
const tempDirWithProfile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'talk-picker-compare-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'profile.json'), JSON.stringify(persona.profile));
  return dir;
};
const testMastra = () => createMastra({ MODEL_MODE: 'mock' }, { agents: AGENTS });

afterEach(() => clearCurrentRun());

describe('rankingForCompare', () => {
  test('uses the 14:15 ranking of the last plan, else programme order with a note', () => {
    const runDir = tempDirWithProfile();
    const fallback = rankingForCompare(runDir);
    expect(fallback.source).toContain('no pnpm plan yet');
    expect(fallback.ranking.slot).toBe(COMPARE_SLOT);
    expect(fallback.ranking.ranking).toHaveLength(6);
    const ranking = { slot: COMPARE_SLOT, ranking: ['fm26-1250255'], reason: 'r', confidence: 0.9 };
    writeLastRun(
      'plan',
      {
        traceId: 'tr-1',
        tokens: 1,
        latencyMs: 1,
        plan: {
          rankings: [ranking, { ...ranking, slot: '15:30' }, { ...ranking, slot: '16:30' }],
          tips: [],
        },
      },
      runDir,
    );
    expect(rankingForCompare(runDir)).toEqual({ ranking, source: 'last pnpm plan' });
  });
});

describe('runCompare', () => {
  test('mock mode: variant A carries every archive abstract, variant B the top-5; numbers per variant; file written', async () => {
    // Arrange
    const runDir = tempDirWithProfile();
    const queries: string[] = [];
    const ids = ['tr-a'.padEnd(35, '0'), 'tr-b'.padEnd(35, '0')];

    // Act
    const result = await runCompare([], {
      env: { MODEL_MODE: 'mock' },
      mastra: testMastra(),
      runDir,
      retrieve: async (queryText) => {
        queries.push(queryText);
        return allArchiveHits().slice(0, RETRIEVAL_TOP_K);
      },
      nextTraceId: () => ids.shift(),
    });

    // Assert
    expect(result.variants.map((v) => v.variant)).toEqual(['in-prompt', 'retrieval']);
    expect(result.variants[0]?.candidates).toBe(30);
    expect(result.variants[1]?.candidates).toBe(RETRIEVAL_TOP_K);
    expect(result.variants[0]!.tokens!).toBeGreaterThan(result.variants[1]!.tokens!);
    expect(result.variants.map((v) => v.traceId)).toEqual([
      'tr-a'.padEnd(35, '0'),
      'tr-b'.padEnd(35, '0'),
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain(persona.profile.interests[0]);
    expect(result.participantId).toBe('mock');
    const last = readLastRun('compare', runDir);
    expect(last).toMatchObject({ kind: 'compare', traceId: 'tr-a'.padEnd(35, '0') });
    expect(last?.['variants']).toHaveLength(2);
    const text = formatCompare(result);
    expect(text).toContain('in-prompt  |');
    expect(text).toContain('retrieval  |');
    expect(text).toContain('programme order');
  });

  test('live env registers both traces; the default retrieval and unrecorded ids still work', async () => {
    const runDir = tempDirWithProfile();
    const calls: string[] = [];
    const config = backendConfigFrom(
      { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
      {
        fetchImpl: async (url, init) => {
          calls.push(`${url.replace('https://ws.test', '')} ${init?.body ?? ''}`);
          if (url.endsWith('/api/whoami'))
            return new Response('{"ok":true,"participantId":"otter-42"}', { status: 200 });
          return new Response('{"ok":true}', { status: 200 });
        },
      },
    );
    const result = await runCompare([], {
      env: { MODEL_MODE: 'live' },
      mastra: testMastra(),
      runDir,
      backend: config,
    });
    expect(result.participantId).toBe('otter-42');
    expect(result.variants[1]?.candidates).toBe(RETRIEVAL_TOP_K);
    expect(result.variants.map((v) => v.traceId)).toEqual([
      'tr-compare-in-prompt-unrecorded',
      'tr-compare-retrieval-unrecorded',
    ]);
    expect(calls.filter((c) => c.startsWith('/api/runs'))).toHaveLength(2);
    expect(calls[1]).toContain('"kind":"compare"');
  });

  test("--profile reads a persona file; without it the last plan's profile wins over profile.json", async () => {
    // Arrange: no profile.json at all, as after `pnpm plan --profile <persona>`
    const runDir = mkdtempSync(join(tmpdir(), 'talk-picker-compare-flag-'));
    const personaFile = 'data/cvs/profiles/02-senior-react-architect.json';

    // Act + Assert: the flag
    const flagged = await runCompare(['--profile', personaFile], {
      env: { MODEL_MODE: 'mock' },
      mastra: testMastra(),
      runDir,
    });
    expect(flagged.profileSource).toBe(personaFile);
    expect(formatCompare(flagged)).toContain(`profile from ${personaFile}`);
    expect(resolveCompareProfile(['--profile', personaFile], runDir).profile).toEqual(
      persona.profile,
    );
    expect(() => resolveCompareProfile(['--profile', 'nope.json'], runDir)).toThrow(
      'persona profiles live in data/cvs/profiles/',
    );

    // Act + Assert: the profile recorded by the last plan
    const other = { ...persona.profile, role: 'recorded by pnpm plan' };
    writeFileSync(join(runDir, 'profile.json'), JSON.stringify(persona.profile));
    writeLastRun('plan', { traceId: 'tr-1', tokens: 1, latencyMs: 1, profile: other }, runDir);
    expect(resolveCompareProfile([], runDir)).toEqual({ profile: other, source: 'last pnpm plan' });
  });

  test('without a profile the message says what to run', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'talk-picker-compare-empty-'));
    await expect(
      runCompare([], { env: { MODEL_MODE: 'mock' }, mastra: testMastra(), runDir }),
    ).rejects.toThrow('or `pnpm compare --profile data/cvs/profiles/<persona>.json`');
  });
});
