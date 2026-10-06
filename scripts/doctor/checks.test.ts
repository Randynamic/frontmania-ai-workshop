import { describe, expect, test } from 'vitest';
import {
  checkBackend,
  checkData,
  checkEnvKeys,
  checkIdentity,
  checkNode,
  checkPnpm,
  checkProxy,
  checkTracing,
  formatIdentityLine,
  formatLine,
  runDoctor,
} from './checks.js';
import type { DoctorEnvironment, FetchInit, FetchOutcome } from './types.js';

const healthyResponses: Record<string, FetchOutcome> = {
  'https://ws.test/proxy/v1/models': {
    kind: 'response',
    status: 200,
    body: { data: [{ id: 'talk-picker-task' }, { id: 'talk-picker-embed' }] },
  },
  'https://ws.test/api/health': { kind: 'response', status: 200, body: { ok: true, mlflow: true } },
  'https://ws.test/otel/health': { kind: 'response', status: 200, body: 'OK' },
  'https://ws.test/api/whoami': {
    kind: 'response',
    status: 200,
    body: { participantId: 'otter-42' },
  },
};

const baseEnv: DoctorEnvironment = {
  nodeVersion: 'v22.23.3',
  pnpmVersion: '12.6.0',
  packageManager: 'pnpm@12.6.0',
  env: {
    PROXY_API_KEY: 'sk-test',
    PROXY_BASE_URL: 'https://ws.test/proxy/v1',
    WORKSHOP_BACKEND_URL: 'https://ws.test',
    MLFLOW_OTLP_ENDPOINT: 'https://ws.test/otel/v1/traces',
    MODEL_MODE: 'live',
  },
  fileExists: () => true,
  readFile: (path) =>
    path === 'data/archive-manifest.json' ? JSON.stringify({ mode: 'live' }) : undefined,
  fetchJson: async (url) =>
    healthyResponses[url] ?? { kind: 'response', status: 404, body: 'not found' },
};

const HTTP_CONFLICT = 409;

const withOverrides = (overrides: Partial<DoctorEnvironment>): DoctorEnvironment => ({
  ...baseEnv,
  ...overrides,
});

const withResponse = (url: string, outcome: FetchOutcome): DoctorEnvironment =>
  withOverrides({
    fetchJson: async (u, init) => (u === url ? outcome : baseEnv.fetchJson(u, init)),
  });

const recordingEnv = (
  calls: { url: string; init?: FetchInit }[],
  overrides: Partial<DoctorEnvironment> = {},
): DoctorEnvironment =>
  withOverrides({
    ...overrides,
    fetchJson: async (url, init) => {
      calls.push(init === undefined ? { url } : { url, init });
      return baseEnv.fetchJson(url, init);
    },
  });

describe('local checks', () => {
  test('node passes on 22.23.3, warns on 24, fails below 22.13', () => {
    expect(checkNode(baseEnv).status).toBe('OK');
    expect(checkNode(withOverrides({ nodeVersion: 'v24.18.0' })).status).toBe('WARN');
    expect(checkNode(withOverrides({ nodeVersion: 'v22.12.0' })).status).toBe('FAIL');
    expect(checkNode(withOverrides({ nodeVersion: 'v20.19.0' })).detail).toContain('nvm install');
  });

  test('pnpm must match packageManager', () => {
    expect(checkPnpm(baseEnv).status).toBe('OK');
    expect(checkPnpm(withOverrides({ pnpmVersion: '11.10.0' })).detail).toContain(
      'corepack enable',
    );
    expect(checkPnpm(withOverrides({ pnpmVersion: undefined })).status).toBe('FAIL');
  });

  test('env check names every missing key', () => {
    const result = checkEnvKeys(withOverrides({ env: { PROXY_BASE_URL: 'x' } }));
    expect(result.status).toBe('FAIL');
    expect(result.detail).toContain('PROXY_API_KEY');
    expect(result.detail).toContain('MLFLOW_OTLP_ENDPOINT');
    expect(result.detail).toContain('your card');
  });

  test('data check reports the fixture and asks for pnpm ingest when the db is missing', () => {
    expect(checkData(baseEnv)).toEqual({
      name: 'data',
      status: 'OK',
      detail: 'data/program-2026.json, data/archive.db (live index)',
    });
    const fixtureOnly = withOverrides({ fileExists: (p) => p !== 'data/program-2026.json' });
    expect(checkData(fixtureOnly).detail).toContain('fixture');
    const noDb = withOverrides({ fileExists: (p) => p !== 'data/archive.db' });
    expect(checkData(noDb).detail).toContain('pnpm ingest');
    const nothing = withOverrides({ fileExists: () => false });
    expect(checkData(nothing).status).toBe('FAIL');
  });

  test('data check fails on a mock-built index in live mode and accepts it in mock mode', () => {
    const mockIndex = (mode: string) =>
      withOverrides({
        env: { ...baseEnv.env, MODEL_MODE: mode },
        readFile: () => JSON.stringify({ mode: 'mock', dimension: 256 }),
      });
    const live = checkData(mockIndex('live'));
    expect(live.status).toBe('FAIL');
    expect(live.detail).toContain('built in mock mode');
    expect(live.detail).toContain('pnpm ingest');
    expect(checkData(mockIndex('mock')).status).toBe('OK');
    expect(checkData(mockIndex('mock')).detail).toContain('(mock index)');
    const noManifest = withOverrides({ readFile: () => undefined });
    expect(checkData(noManifest).detail).toContain('archive-manifest.json missing');
    const broken = withOverrides({ readFile: () => '{not json' });
    expect(checkData(broken).status).toBe('FAIL');
    const noMode = withOverrides({ readFile: () => '{}' });
    expect(checkData(noMode).detail).toContain('no mode');
  });
});

describe('network checks', () => {
  test('proxy passes when both aliases are listed', async () => {
    expect((await checkProxy(baseEnv)).status).toBe('OK');
  });

  test('proxy distinguishes wrong key, missing alias and network error', async () => {
    const unauthorized = withResponse('https://ws.test/proxy/v1/models', {
      kind: 'response',
      status: 401,
      body: {},
    });
    expect((await checkProxy(unauthorized)).detail).toContain('wrong key');

    const missingAlias = withResponse('https://ws.test/proxy/v1/models', {
      kind: 'response',
      status: 200,
      body: { data: [{ id: 'talk-picker-task' }] },
    });
    expect((await checkProxy(missingAlias)).detail).toContain('talk-picker-embed');

    const down = withResponse('https://ws.test/proxy/v1/models', {
      kind: 'network-error',
      message: 'ECONNREFUSED',
    });
    expect((await checkProxy(down)).detail).toContain('ask the floater');
  });

  test('backend requires ok and mlflow', async () => {
    expect((await checkBackend(baseEnv)).status).toBe('OK');
    const mlflowDown = withResponse('https://ws.test/api/health', {
      kind: 'response',
      status: 200,
      body: { ok: true, mlflow: false },
    });
    expect((await checkBackend(mlflowDown)).detail).toContain('MLflow down');
  });

  test('tracing derives the health url from the OTLP endpoint', async () => {
    expect((await checkTracing(baseEnv)).status).toBe('OK');
    const badEndpoint = withOverrides({
      env: { ...baseEnv.env, MLFLOW_OTLP_ENDPOINT: 'https://x' },
    });
    expect((await checkTracing(badEndpoint)).detail).toContain('/v1/traces');
  });

  test('identity returns the pseudonym (slip variant: no register call)', async () => {
    const calls: { url: string; init?: FetchInit }[] = [];
    const { result, participantId } = await checkIdentity(recordingEnv(calls));
    expect(result.status).toBe('OK');
    expect(participantId).toBe('otter-42');
    expect(calls.map((c) => c.url)).toEqual(['https://ws.test/api/whoami']);
    const revoked = withResponse('https://ws.test/api/whoami', {
      kind: 'response',
      status: 401,
      body: {},
    });
    expect((await checkIdentity(revoked)).result.detail).toContain('revoked');
  });

  test('identity registers TALK_PICKER_ID first in the page variant', async () => {
    const calls: { url: string; init?: FetchInit }[] = [];
    const env = recordingEnv(calls, { env: { ...baseEnv.env, TALK_PICKER_ID: 'heron-10' } });
    const { result } = await checkIdentity({
      ...env,
      fetchJson: async (url, init) =>
        url.endsWith('/api/register')
          ? (calls.push(init === undefined ? { url } : { url, init }),
            { kind: 'response', status: 200, body: { ok: true } })
          : env.fetchJson(url, init),
    });
    expect(result.status).toBe('OK');
    expect(calls[0]).toEqual({
      url: 'https://ws.test/api/register',
      init: {
        method: 'POST',
        headers: { Authorization: 'Bearer sk-test' },
        body: { participantId: 'heron-10' },
      },
    });
  });

  test('identity explains an unlinked key and a rejected registration', async () => {
    const unlinked = withResponse('https://ws.test/api/whoami', {
      kind: 'response',
      status: HTTP_CONFLICT,
      body: { error: 'key not linked' },
    });
    expect((await checkIdentity(unlinked)).result.detail).toContain('TALK_PICKER_ID');
    const rejected = withOverrides({
      env: { ...baseEnv.env, TALK_PICKER_ID: 'nope-1' },
      fetchJson: async (url, init) =>
        url.endsWith('/api/register')
          ? { kind: 'response', status: 400, body: { error: 'id nope-1 was not issued' } }
          : baseEnv.fetchJson(url, init),
    });
    expect((await checkIdentity(rejected)).result.detail).toContain('not issued');
  });
});

describe('runDoctor', () => {
  test('prints eight lines in order and exits 0 when healthy', async () => {
    const report = await runDoctor(baseEnv);
    expect(report.results.map((r) => r.name)).toEqual([
      'node',
      'pnpm',
      '.env',
      'data',
      'proxy',
      'backend',
      'tracing',
      'identity',
    ]);
    expect(report.exitCode).toBe(0);
    expect(formatIdentityLine(report.participantId ?? '')).toBe(
      'You are otter-42. Use this id on the blind-pick page.',
    );
  });

  test('a WARN does not fail, a FAIL does', async () => {
    const warnOnly = await runDoctor(withOverrides({ nodeVersion: 'v24.18.0' }));
    expect(warnOnly.exitCode).toBe(0);
    const failing = await runDoctor(withOverrides({ env: {} }));
    expect(failing.exitCode).toBe(1);
    expect(failing.participantId).toBeUndefined();
  });

  test('formatLine is one line per check', () => {
    expect(formatLine({ name: 'node', status: 'OK', detail: 'v22.23.3' })).toBe(
      'OK   node      v22.23.3',
    );
  });
});
