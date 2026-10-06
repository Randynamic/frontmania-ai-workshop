import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { formatIdentityLine, formatLine, runDoctor } from './doctor/checks.js';
import { describeNetworkError } from './doctor/network-error.js';
import type { DoctorEnvironment, FetchInit, FetchOutcome } from './doctor/types.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const NETWORK_TIMEOUT_MS = 3_000;

const readPackageManager = (): string => {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
    packageManager?: string;
  };
  return pkg.packageManager ?? 'pnpm';
};

const detectPnpmVersion = (): string | undefined => {
  const fromAgent = /pnpm\/(\S+)/.exec(process.env.npm_config_user_agent ?? '')?.[1];
  if (fromAgent) return fromAgent;
  try {
    return execFileSync('pnpm', ['--version'], {
      encoding: 'utf8',
      timeout: NETWORK_TIMEOUT_MS,
    }).trim();
  } catch {
    return undefined;
  }
};

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const fetchJson = async (url: string, init: FetchInit = {}): Promise<FetchOutcome> => {
  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    return { kind: 'response', status: response.status, body: parseBody(await response.text()) };
  } catch (error) {
    return { kind: 'network-error', message: describeNetworkError(error, NETWORK_TIMEOUT_MS) };
  }
};

const readRepoFile = (relativePath: string): string | undefined => {
  try {
    return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
  } catch {
    return undefined;
  }
};

const environment: DoctorEnvironment = {
  nodeVersion: process.version,
  pnpmVersion: detectPnpmVersion(),
  packageManager: readPackageManager(),
  env: process.env,
  fileExists: (relativePath) => existsSync(resolve(REPO_ROOT, relativePath)),
  readFile: readRepoFile,
  fetchJson,
};

const main = async (): Promise<void> => {
  const started = Date.now();
  const report = await runDoctor(environment);
  for (const result of report.results) console.log(formatLine(result));
  if (report.participantId) console.log(formatIdentityLine(report.participantId));
  console.log(`doctor finished in ${Date.now() - started} ms, exit ${report.exitCode}`);
  process.exit(report.exitCode);
};

main().catch((error: unknown) => {
  console.error('doctor crashed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
