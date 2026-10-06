import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { backendConfigFrom } from '../../src/backend/client.js';
import { loadPersonas } from '../../src/data/personas.js';
import { clearCurrentRun, getCurrentRun } from '../../src/feedback/current-run.js';
import { createProfileAgent } from '../../src/mastra/agents/profile.js';
import { AGENTS, createMastra } from '../../src/mastra/index.js';
import { createMockTaskModel } from '../../src/mastra/model.js';
import { TokenTallyExporter } from '../../src/observability/token-tally.js';
import { clearRawTextRegistry } from '../../src/observability/raw-text-registry.js';
import { readLastRun } from '../../src/run/record.js';
import { Plan } from '../../src/schemas/plan.js';
import { CapturingExporter } from '../../src/test-support/capturing-exporter.js';
import { solvedPlanWorkflow } from '../../src/test-support/solved-plan-workflow.js';
import { MOCK_PARTICIPANT_ID, runProfile } from '../profile/run.js';
import {
  formatChanges,
  formatPlan,
  formatRunSummary,
  formatTopPicks,
  previousTopPicks,
  resolveProfile,
  runPlan,
  topPicksOf,
} from './run.js';

const persona = loadPersonas()[1]!;
const PROFILE_FLAG = 'data/cvs/profiles/02-senior-react-architect.json';

const tempDir = () => mkdtempSync(join(tmpdir(), 'talk-picker-plan-'));
const testMastra = () => {
  const tally = new TokenTallyExporter();
  const mastra = createMastra(
    { MODEL_MODE: 'mock' },
    { agents: AGENTS, workflows: { plan: solvedPlanWorkflow }, exporters: [tally] },
  );
  return { mastra, tally };
};

const fakeBackend = () => {
  const calls: { url: string; body: unknown }[] = [];
  const config = backendConfigFrom(
    { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith('/api/whoami'))
          return new Response('{"ok":true,"participantId":"otter-42"}', { status: 200 });
        return new Response('{"ok":true}', { status: 200 });
      },
    },
  );
  return { config, calls };
};

afterEach(() => {
  clearCurrentRun();
  clearRawTextRegistry();
});

describe('resolveProfile', () => {
  test('reads --profile, falls back to .talk-picker/profile.json, and names the fix when neither exists', async () => {
    const runDir = tempDir();
    const deps = { env: { MODEL_MODE: 'mock' }, mastra: testMastra().mastra, runDir };
    await expect(resolveProfile([], deps)).rejects.toThrow(
      'run `pnpm run profile --cv <file>` first, or `pnpm plan --profile data/cvs/profiles/<persona>.json`',
    );
    expect((await resolveProfile(['--profile', PROFILE_FLAG], deps)).profile).toEqual(
      persona.profile,
    );
    expect((await resolveProfile([], deps)).source).toBe('.talk-picker/profile.json');
    writeFileSync(join(runDir, 'profile.json'), '{"role":"x"}');
    await expect(resolveProfile([], deps)).rejects.toThrow('not a valid Profile');
    await expect(resolveProfile(['--profile', 'nope.json'], deps)).rejects.toThrow(
      'cannot read nope.json',
    );
    await expect(resolveProfile(['--profile', 'a', '--cv', 'b'], deps)).rejects.toThrow('not both');
  });

  test('--cv regenerates the profile through the profile agent first', async () => {
    const runDir = tempDir();
    const { profile, source } = await resolveProfile(['--cv', persona.cvPath], {
      env: { MODEL_MODE: 'mock' },
      mastra: testMastra().mastra,
      runDir,
      readText: (path) => readFileSync(path, 'utf8'),
    });
    expect(profile.role).toBe('front-end developer'); // the mock profile
    expect(source).toContain('regenerated');
    expect(existsSync(join(runDir, 'profile.json'))).toBe(true);
  });
});

describe('resolveProfile persists a persona only when there is no profile', () => {
  test('--profile without a profile.json writes it, so a bare pnpm plan works afterwards', async () => {
    // Arrange
    const runDir = tempDir();
    const deps = { env: { MODEL_MODE: 'mock' }, mastra: testMastra().mastra, runDir };

    // Act
    const first = await resolveProfile(['--profile', PROFILE_FLAG], deps);
    const later = await resolveProfile([], deps);

    // Assert
    expect(first.saved).toBe(true);
    expect(later.profile).toEqual(persona.profile);
  });

  test('an existing profile.json (your own) is never overwritten by --profile', async () => {
    const runDir = tempDir();
    const own = { ...persona.profile, role: 'my own role' };
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'profile.json'), JSON.stringify(own));
    const deps = { env: { MODEL_MODE: 'mock' }, mastra: testMastra().mastra, runDir };
    expect((await resolveProfile(['--profile', PROFILE_FLAG], deps)).saved).toBe(false);
    expect((await resolveProfile([], deps)).profile.role).toBe('my own role');
  });
});

describe('runPlan', () => {
  test('mock mode: three rankings, three tips, top picks, tally tokens, last-plan.json, no backend', async () => {
    // Arrange
    const runDir = tempDir();
    const { mastra, tally } = testMastra();

    // Act
    const result = await runPlan(['--profile', PROFILE_FLAG], {
      env: { MODEL_MODE: 'mock' },
      mastra,
      tally,
      runDir,
    });

    // Assert
    expect(Plan.safeParse(result.plan).success).toBe(true);
    expect(result.plan.tips).toHaveLength(3);
    expect(result.participantId).toBe(MOCK_PARTICIPANT_ID);
    expect(result.traceId).toMatch(/^tr-[0-9a-f]{32}$/);
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.previousTopPicks).toBeUndefined();
    expect(Object.keys(result.topPicks)).toEqual(['14:15', '15:30', '16:30']);
    const last = readLastRun('plan', runDir);
    expect(last).toMatchObject({
      kind: 'plan',
      traceId: result.traceId,
      topPicks: result.topPicks,
      profileSource: PROFILE_FLAG,
    });
    // pnpm compare picks the profile up from here when the plan ran with --profile
    expect(last?.['profile']).toEqual(persona.profile);
    expect(Plan.safeParse(last?.['plan']).success).toBe(true);
    expect(getCurrentRun()).toBeUndefined();
  });

  test('--cv on one Mastra instance: profile first, then a traced plan with three rankSlot steps', async () => {
    // Arrange: one instance for both runs, as `pnpm plan --cv <file>` builds it
    const runDir = tempDir();
    const capture = new CapturingExporter();
    const mastra = createMastra(
      { MODEL_MODE: 'mock' },
      { agents: AGENTS, workflows: { plan: solvedPlanWorkflow }, exporters: [capture] },
    );

    // Act
    const result = await runPlan(['--cv', persona.cvPath], {
      env: { MODEL_MODE: 'mock' },
      mastra,
      runDir,
      readText: (path) => readFileSync(path, 'utf8'),
    });

    // Assert
    expect(result.traceId).toMatch(/^tr-[0-9a-f]{32}$/);
    expect(result.profileSource).toContain('regenerated');
    const spans = capture.spans as { type: string; name: string }[];
    expect(spans.filter((s) => s.type === 'agent_run' && s.name.includes('profile'))).toHaveLength(
      1,
    );
    expect(
      spans.filter((s) => s.type === 'workflow_step' && s.name.includes('rankSlot')),
    ).toHaveLength(3);
    expect(readLastRun('plan', runDir)).toMatchObject({ traceId: result.traceId });
    expect(readLastRun('profile', runDir)).toBeDefined();
  });

  test('live env: whoami first, run registered with the tr- id, previous top picks reported on a rerun', async () => {
    const runDir = tempDir();
    const backend = fakeBackend();
    const first = await runPlan(['--profile', PROFILE_FLAG], {
      env: { MODEL_MODE: 'live' },
      mastra: testMastra().mastra,
      runDir,
      backend: backend.config,
    });
    expect(first.participantId).toBe('otter-42');
    expect(backend.calls.map((c) => c.url.replace('https://ws.test', ''))).toEqual([
      '/api/whoami',
      '/api/runs',
    ]);
    expect(backend.calls[1]?.body).toEqual({ traceId: first.traceId, kind: 'plan' });
    expect(getCurrentRun()).toEqual({ traceId: first.traceId, kind: 'plan' });
    expect(previousTopPicks(runDir)).toEqual(first.topPicks);

    const second = await runPlan(['--profile', PROFILE_FLAG], {
      env: { MODEL_MODE: 'live' },
      mastra: testMastra().mastra,
      runDir,
      backend: backend.config,
    });
    expect(second.previousTopPicks).toEqual(first.topPicks);
    expect(formatChanges(second.previousTopPicks, second.topPicks)).toBe(
      'changed since last run: nothing, same three top picks',
    );
  });

  test('a failed workflow surfaces the step error, and nothing is written', async () => {
    const runDir = tempDir();
    const { mastra } = testMastra();
    const broken = {
      ...mastra,
      getWorkflow: () => ({
        createRun: async () => ({
          start: async () => ({ status: 'failed', error: new Error('rankSlot exploded') }),
        }),
      }),
      shutdown: async () => undefined,
    };
    await expect(
      runPlan(['--profile', PROFILE_FLAG], {
        env: { MODEL_MODE: 'mock' },
        mastra: broken as never,
        runDir,
      }),
    ).rejects.toThrow('rankSlot exploded');
    expect(existsSync(join(runDir, 'last-plan.json'))).toBe(false);
  });
});

describe('formatting', () => {
  test('plan table, top picks line, change line and summary', async () => {
    const { mastra, tally } = testMastra();
    const result = await runPlan(['--profile', PROFILE_FLAG], {
      env: { MODEL_MODE: 'mock' },
      mastra,
      tally,
      runDir: tempDir(),
    });
    const table = formatPlan(result.plan);
    expect(table).toContain('14:15  (confidence 0.50)');
    expect(table).toContain('  1. [fm26-');
    expect(table).toContain('  tip: [fm25-');
    expect(formatTopPicks(topPicksOf(result.plan))).toMatch(
      /^top picks: 14:15 fm26-\d+ \| 15:30 fm26-\d+ \| 16:30 fm26-\d+$/,
    );
    expect(formatChanges(undefined, result.topPicks)).toBeUndefined();
    expect(formatChanges({ ...result.topPicks, '14:15': 'fm26-old' }, result.topPicks)).toBe(
      `changed since last run: 14:15 fm26-old -> ${result.topPicks['14:15']}`,
    );
    const summary = formatRunSummary(result);
    expect(summary).toContain(`tokens: ${result.tokens}  latency: ${result.latencyMs} ms`);
    expect(summary).toContain('profile: data/cvs/profiles/02-senior-react-architect.json');
    expect(summary).toContain('as .talk-picker/profile.json (you had none)');
  });
});

describe('an echoed identity from pnpm run profile never reaches a later plan trace', () => {
  test('profile.json is scrubbed, so the ranker prompts of a new process carry the marker, not the employer', async () => {
    // Arrange: process 1, `pnpm run profile` with a model that copies the employer and the name
    const runDir = tempDir();
    const echoReply = () =>
      JSON.stringify({
        role: 'Lead Front-end Architect at Kanaalwerk Digital',
        seniority: 'lead',
        stack: ['TypeScript', 'React'],
        interests: ['design systems', 'what Femke Oosterhuis builds'],
        avoid: [],
      });
    const profileMastra = createMastra(
      { MODEL_MODE: 'mock' },
      {
        exporters: [new CapturingExporter()],
        agents: { profile: createProfileAgent(createMockTaskModel(echoReply)) },
      },
    );
    await runProfile(['--cv', 'src/observability/fixtures/fictional-cv.md'], {
      env: { MODEL_MODE: 'mock' },
      mastra: profileMastra,
      readText: (path) => readFileSync(path, 'utf8'),
      runDir,
    });
    // Process 2 starts with an empty registry: the trace masker knows no CV any more.
    clearRawTextRegistry();
    const capture = new CapturingExporter();
    const planMastra = createMastra(
      { MODEL_MODE: 'mock' },
      { agents: AGENTS, workflows: { plan: solvedPlanWorkflow }, exporters: [capture] },
    );

    // Act: `pnpm plan` on .talk-picker/profile.json
    const result = await runPlan([], { env: { MODEL_MODE: 'mock' }, mastra: planMastra, runDir });

    // Assert
    expect(result.profileSource).toBe('.talk-picker/profile.json');
    const trace = capture.serialized();
    expect(trace).toContain('Lead Front-end Architect at [cv:sha256:');
    for (const identity of ['kanaalwerk', 'femke', 'oosterhuis']) {
      expect(trace.toLowerCase()).not.toContain(identity);
    }
  });
});
