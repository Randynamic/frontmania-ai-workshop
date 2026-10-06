import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from '../src/data/paths.js';
import { switchBranch, type Git } from './switch/run.js';

/** pnpm run switch <branch>: stash if needed, then check out (see scripts/switch/run.ts). */
const git: Git = (args) =>
  execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

try {
  for (const line of switchBranch(process.argv.slice(2), git).lines) console.log(line);
} catch (error) {
  const stderr = (error as { stderr?: unknown }).stderr;
  const detail = typeof stderr === 'string' && stderr.trim() ? stderr.trim() : undefined;
  console.error(
    `pnpm run switch failed: ${detail ?? (error instanceof Error ? error.message : String(error))}`,
  );
  process.exit(1);
}
