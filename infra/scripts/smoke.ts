import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from './lib/args.js';

/**
 * pnpm smoke [--skip-doctor]
 * Trainer-side end-to-end check with one participant key in the root .env:
 * doctor, the backend routes a participant touches, then every participant
 * script that exists on this branch (profile, plan, ask, check:01..03).
 * Scripts missing from package.json are reported as SKIP (00-setup has none).
 * Exit 0 only when everything that ran passed.
 */
const REPO_ROOT = resolve(import.meta.dirname, '../..');
const TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 5_000;
const OTLP_SUFFIX = '/v1/traces';
const HTTP_NOT_FOUND = 404;

type Outcome = 'OK' | 'FAIL' | 'SKIP';
interface Row {
  readonly step: string;
  readonly outcome: Outcome;
  readonly note: string;
}

const PARTICIPANT_STEPS: readonly { script: string; args: readonly string[] }[] = [
  { script: 'profile', args: ['--cv', 'data/cvs/02-senior-react-architect.md'] },
  { script: 'check:01', args: [] },
  { script: 'plan', args: [] },
  { script: 'compare', args: [] },
  { script: 'check:02', args: [] },
  {
    script: 'ask',
    args: [
      'plan my afternoon, no Angular, something on accessibility',
      '--feedback',
      'up:clear;down:too basic;up:relevant',
    ],
  },
  { script: 'check:03', args: [] },
];

const packageScripts = (): Record<string, string> =>
  (
    JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;

const runScript = (script: string, args: readonly string[]): Row => {
  const started = Date.now();
  const result = spawnSync('pnpm', ['run', script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const lastLine = (result.stdout + result.stderr).trim().split('\n').at(-1) ?? '';
  return {
    step: `pnpm run ${script}`,
    outcome: result.status === 0 ? 'OK' : 'FAIL',
    note: `exit ${result.status ?? 'signal'} in ${seconds} s: ${lastLine.slice(0, 80)}`,
  };
};

const probe = async (
  step: string,
  url: string,
  headers: Record<string, string>,
  expectStatus: number,
): Promise<Row> => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const text = (await response.text()).slice(0, 80);
    return {
      step,
      outcome: response.status === expectStatus ? 'OK' : 'FAIL',
      note: `HTTP ${response.status} ${text}`,
    };
  } catch (error) {
    return { step, outcome: 'FAIL', note: error instanceof Error ? error.message : String(error) };
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2), new Set(['skip-doctor']));
  const key = process.env['PROXY_API_KEY'] ?? '';
  const backend = (process.env['WORKSHOP_BACKEND_URL'] ?? '').replace(/\/$/, '');
  if (!key || !backend)
    throw new Error(
      'PROXY_API_KEY and WORKSHOP_BACKEND_URL must be set in .env (a participant key, not the admin token)',
    );
  const bearer = { authorization: `Bearer ${key}` };
  const scripts = packageScripts();
  const otlpEndpoint = process.env['MLFLOW_OTLP_ENDPOINT'] ?? '';
  const otelBase = otlpEndpoint.endsWith(OTLP_SUFFIX)
    ? otlpEndpoint.slice(0, -OTLP_SUFFIX.length)
    : '';

  const rows: Row[] = [
    ...(args.flags['skip-doctor'] === true ? [] : [runScript('doctor', [])]),
    await probe('GET /api/health', `${backend}/api/health`, {}, 200),
    await probe('GET /api/whoami', `${backend}/api/whoami`, bearer, 200),
    await probe('GET /api/program', `${backend}/api/program`, {}, 200),
    await probe('GET /api/prompts/ranker', `${backend}/api/prompts/ranker`, bearer, 200),
    // A participant key must never reach the MLflow REST API through the gateway.
    otelBase
      ? await probe(
          'GET /otel/<mlflow api> is 404',
          `${otelBase}/api/2.0/mlflow/experiments/search`,
          bearer,
          HTTP_NOT_FOUND,
        )
      : {
          step: 'GET /otel/<mlflow api> is 404',
          outcome: 'FAIL' as const,
          note: `MLFLOW_OTLP_ENDPOINT must end in ${OTLP_SUFFIX}`,
        },
    ...PARTICIPANT_STEPS.map(({ script, args: scriptArgs }) =>
      scripts[script]
        ? runScript(script, scriptArgs)
        : { step: `pnpm run ${script}`, outcome: 'SKIP' as const, note: 'not on this branch' },
    ),
  ];

  for (const row of rows)
    console.log(`${row.outcome.padEnd(4)} ${row.step.padEnd(28)} ${row.note}`);
  const failed = rows.filter((row) => row.outcome === 'FAIL').length;
  const skipped = rows.filter((row) => row.outcome === 'SKIP').length;
  console.log(`smoke: ${rows.length - failed - skipped} ok, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
