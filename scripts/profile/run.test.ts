import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { backendConfigFrom } from '../../src/backend/client.js';
import { DATA_PATHS, REPO_ROOT } from '../../src/data/paths.js';
import { clearCurrentRun, getCurrentRun } from '../../src/feedback/current-run.js';
import { createProfileAgent } from '../../src/mastra/agents/profile.js';
import { createMastra } from '../../src/mastra/index.js';
import { createMockTaskModel } from '../../src/mastra/model.js';
import { clearRawTextRegistry } from '../../src/observability/raw-text-registry.js';
import { readLastRun } from '../../src/run/record.js';
import { CapturingExporter } from '../../src/test-support/capturing-exporter.js';
import {
  formatProfile,
  formatRunSummary,
  inputHash,
  MOCK_PARTICIPANT_ID,
  resolveInput,
  runProfile,
  scrubProfile,
} from './run.js';
import { parseArgs } from '../lib/args.js';

const CV = 'data/cvs/02-senior-react-architect.md';
const cvText = readFileSync(join(DATA_PATHS.cvsDir, '02-senior-react-architect.md'), 'utf8');
const readText = (path: string): string => readFileSync(path, 'utf8');
/** The masking fixture: name line "Femke Oosterhuis-Bakker", employer **Kanaalwerk Digital, Amsterdam**. */
const FICTIONAL_CV = 'src/observability/fixtures/fictional-cv.md';
const fictionalCvText = readFileSync(join(REPO_ROOT, FICTIONAL_CV), 'utf8');

const leadReply = () =>
  JSON.stringify({
    role: 'front-end architect at a logistics scale-up',
    seniority: 'lead',
    stack: ['TypeScript', 'React'],
    interests: ['tracing for LLM features'],
    avoid: ['vendor keynotes'],
  });

/** A Mastra instance in mock mode with a capturing exporter, as the real one minus the network. */
const testMastra = (reply = leadReply) => {
  const capture = new CapturingExporter();
  const mastra = createMastra(
    { MODEL_MODE: 'mock' },
    { exporters: [capture], agents: { profile: createProfileAgent(createMockTaskModel(reply)) } },
  );
  return { mastra, capture };
};

const fakeBackend = () => {
  const calls: { url: string; body: unknown }[] = [];
  const config = backendConfigFrom(
    { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-card' },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith('/api/whoami')) {
          return new Response('{"ok":true,"participantId":"otter-42"}', { status: 200 });
        }
        return new Response('{"ok":true}', { status: 200 });
      },
    },
  );
  return { config, calls };
};

const tempDir = () => mkdtempSync(join(tmpdir(), 'talk-picker-profile-'));

afterEach(() => {
  clearRawTextRegistry();
  clearCurrentRun();
});

describe('resolveInput', () => {
  test('reads --cv relative to the repo root and rejects both flags or neither', () => {
    const input = resolveInput(parseArgs(['--cv', CV]), readText);
    expect(input.kind).toBe('cv');
    expect(input.text).toBe(cvText);
    expect(() => resolveInput(parseArgs([]), readText)).toThrow('usage');
    expect(() => resolveInput(parseArgs(['--cv', CV, '--skills', 'x']), readText)).toThrow(
      'not both',
    );
  });

  test('--cv - reads the CV from stdin and records no path', () => {
    const paths: string[] = [];
    const fromStdin = (path: string): string => {
      paths.push(path);
      return cvText;
    };
    expect(resolveInput(parseArgs(['--cv', '-']), fromStdin)).toEqual({
      kind: 'stdin',
      text: cvText,
    });
    expect(paths).toEqual(['-']);
    expect(() => resolveInput(parseArgs(['--cv', '-']), () => '  \n')).toThrow('nothing on stdin');
  });

  test('a missing file names the path; --skills carries the text', () => {
    expect(() => resolveInput(parseArgs(['--cv', 'data/cvs/nope.md']), readText)).toThrow(
      'cannot read data/cvs/nope.md',
    );
    expect(resolveInput(parseArgs(['--skills', 'React, a11y']), readText)).toEqual({
      kind: 'skills',
      text: 'React, a11y',
    });
  });
});

describe('runProfile', () => {
  test('live env: whoami, traced generate, files without CV text, profile and run posted', async () => {
    // Arrange
    const { mastra, capture } = testMastra();
    const backend = fakeBackend();
    const runDir = tempDir();

    // Act
    const result = await runProfile(['--cv', CV], {
      env: { MODEL_MODE: 'live' },
      mastra,
      readText,
      runDir,
      backend: backend.config,
      now: (() => {
        let tick = 1_000;
        return () => (tick += 250);
      })(),
    });

    // Assert: result and numbers
    expect(result.participantId).toBe('otter-42');
    expect(result.profile.seniority).toBe('lead');
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.latencyMs).toBe(250);
    expect(result.traceId).toMatch(/^tr-[0-9a-f]{32}$/);

    // Assert: files hold the profile and the numbers, never the CV
    const profileFile = readFileSync(join(runDir, 'profile.json'), 'utf8');
    expect(JSON.parse(profileFile)).toEqual(result.profile);
    const last = readLastRun('profile', runDir);
    expect(last).toMatchObject({
      kind: 'profile',
      traceId: result.traceId,
      tokens: result.tokens,
      latencyMs: 250,
      participantId: 'otter-42',
      input: { kind: 'cv', path: expect.stringContaining('02-senior-react-architect.md') },
      inputHash: inputHash(cvText),
    });
    for (const text of [profileFile, JSON.stringify(last)]) {
      expect(text).not.toContain('Lotte');
      expect(text).not.toContain('Hexaloop');
    }

    // Assert: backend calls in order, with the tr- id, and the trace is masked
    expect(backend.calls.map((c) => c.url.replace('https://ws.test', ''))).toEqual([
      '/api/whoami',
      '/api/profiles',
      '/api/runs',
    ]);
    expect(backend.calls[1]?.body).toEqual({ profile: result.profile });
    expect(backend.calls[2]?.body).toEqual({ traceId: result.traceId, kind: 'profile' });
    expect(getCurrentRun()).toEqual({ traceId: result.traceId, kind: 'profile' });
    const exported = capture.serialized();
    expect(exported).toContain('[cv:sha256:');
    expect(exported).not.toContain('Lotte Vermeulen');
    expect(exported).not.toContain('Hexaloop');
    expect(exported).toContain('"participantId":"otter-42"');
  });

  test('an echoed name or employer never reaches profile.json, last-profile.json or the POST body', async () => {
    // Arrange: the model copies the employer into role and the name into interests
    const echoReply = () =>
      JSON.stringify({
        role: 'Lead Front-end Architect at Kanaalwerk Digital',
        seniority: 'lead',
        stack: ['TypeScript', 'React'],
        interests: ['talks femke oosterhuis would pick', 'design systems'],
        avoid: [],
      });
    const { mastra, capture } = testMastra(echoReply);
    const backend = fakeBackend();
    const runDir = tempDir();

    // Act
    const result = await runProfile(['--cv', FICTIONAL_CV], {
      env: { MODEL_MODE: 'live' },
      mastra,
      readText,
      runDir,
      backend: backend.config,
    });

    // Assert: the scrubbed profile is what is kept, saved and sent
    expect(result.identityEchoesRemoved).toBe(3);
    expect(result.profile.role).toMatch(/^Lead Front-end Architect at \[cv:sha256:[0-9a-f]{12}\]$/);
    expect(result.profile.interests).toContain('design systems');
    const postedProfile = backend.calls.find((c) => c.url.endsWith('/api/profiles'))?.body;
    expect(postedProfile).toEqual({ profile: result.profile });
    const leaving = [
      readFileSync(join(runDir, 'profile.json'), 'utf8'),
      JSON.stringify(readLastRun('profile', runDir)),
      JSON.stringify(postedProfile),
      capture.serialized(),
    ];
    for (const text of leaving) {
      expect(text.toLowerCase()).not.toContain('kanaalwerk');
      expect(text.toLowerCase()).not.toContain('femke');
      expect(text.toLowerCase()).not.toContain('oosterhuis');
    }
    expect(formatRunSummary(result)).toContain(
      'removed 3 name, employer or contact value(s) the model copied into the profile',
    );
  });

  test('scrubProfile returns the profile untouched when nothing was echoed', () => {
    const profile = {
      role: 'front-end architect',
      seniority: 'lead' as const,
      stack: ['React'],
      interests: [],
      avoid: [],
    };
    expect(scrubProfile(profile, fictionalCvText, '[cv:sha256:0123456789ab]')).toEqual({
      profile,
      identityEchoesRemoved: 0,
    });
  });

  test('mock mode skips the backend, uses the mock id and still writes both files', async () => {
    const { mastra } = testMastra();
    const runDir = tempDir();
    const result = await runProfile(['--skills', 'Six years of React, want accessibility talks'], {
      env: { MODEL_MODE: 'mock' },
      mastra,
      readText,
      runDir,
    });
    expect(result.participantId).toBe(MOCK_PARTICIPANT_ID);
    expect(result.mode).toBe('mock');
    expect(readLastRun('profile', runDir)?.['mode']).toBe('mock');
    expect(result.input).toEqual({ kind: 'skills' });
    expect(existsSync(join(runDir, 'profile.json'))).toBe(true);
    expect(readLastRun('profile', runDir)?.input).toEqual({ kind: 'skills' });
    expect(getCurrentRun()).toBeUndefined();
  });

  test('a model answer that breaks the schema fails before anything is written', async () => {
    const { mastra } = testMastra(() => JSON.stringify({ role: 'dev', seniority: 'principal' }));
    const runDir = tempDir();
    await expect(
      runProfile(['--cv', CV], { env: { MODEL_MODE: 'mock' }, mastra, readText, runDir }),
    ).rejects.toThrow();
    expect(existsSync(join(runDir, 'profile.json'))).toBe(false);
  });

  test('a rejected key surfaces the backend hint', async () => {
    const { mastra } = testMastra();
    const config = backendConfigFrom(
      { WORKSHOP_BACKEND_URL: 'https://ws.test', PROXY_API_KEY: 'sk-old' },
      { fetchImpl: async () => new Response('{"error":"unknown key"}', { status: 401 }) },
    );
    await expect(
      runProfile(['--cv', CV], {
        env: { MODEL_MODE: 'live' },
        mastra,
        readText,
        runDir: tempDir(),
        backend: config,
      }),
    ).rejects.toThrow('re-paste PROXY_API_KEY');
  });
});

describe('formatting', () => {
  test('prints one line per field and the workbook numbers', () => {
    const profile = {
      role: 'dev',
      seniority: 'medior' as const,
      stack: ['React'],
      interests: [],
      avoid: [],
      confidence: { role: 0.8 },
    };
    const table = formatProfile(profile);
    expect(table).toContain('role        dev');
    expect(table).toContain('interests   (none)');
    expect(table).toContain('confidence  {"role":0.8}');
    const summary = formatRunSummary({
      profile,
      participantId: 'otter-42',
      traceId: 'tr-abc',
      tokens: 341,
      latencyMs: 1200,
      input: { kind: 'skills' },
      mode: 'live',
      identityEchoesRemoved: 0,
    });
    expect(summary).toContain('tokens: 341  latency: 1200 ms');
    expect(summary).toContain('trace: tr-abc');
    expect(summary).toContain('no CV text');
    expect(summary).not.toContain('mock');
  });

  test('a mock run marks its numbers as fake and says profile.json now holds the canned profile', () => {
    const summary = formatRunSummary({
      profile: { role: 'dev', seniority: 'medior', stack: [], interests: [], avoid: [] },
      participantId: MOCK_PARTICIPANT_ID,
      traceId: 'tr-abc',
      tokens: 548,
      latencyMs: 3,
      input: { kind: 'skills' },
      mode: 'mock',
      identityEchoesRemoved: 0,
    });
    expect(summary).toContain('tokens: 548 (mock, not for the workbook)');
    expect(summary).toContain('.talk-picker/profile.json: it now holds the canned mock profile');
  });
});
