import { readFileSync } from 'node:fs';
import { formatProfile, formatRunSummary, runProfile, STDIN_PATH } from './profile/run.js';

/**
 * `--cv -` reads stdin to EOF before the run; on a terminal the participant
 * pastes and presses Ctrl-D. Read as a stream: a synchronous read of fd 0 on
 * a TTY fails with EAGAIN.
 */
const readStdin = async (): Promise<string> => {
  if (process.stdin.isTTY)
    console.error('Paste your CV, then press Ctrl-D on an empty line. Nothing is saved to disk.');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
};

const wantsStdin = (argv: readonly string[]): boolean =>
  argv.some((arg, index) => arg === '--cv' && argv[index + 1] === STDIN_PATH);

/**
 * pnpm run profile --cv <file> | --cv - | --skills "<text>"
 *
 * The Mastra instance is imported inside main: building it reads .env and
 * throws when the key or the OTLP endpoint is missing, and that error must
 * reach the catch below as one line with the fix, not a module-load stack.
 */
const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const stdinText = wantsStdin(argv) ? await readStdin() : '';
  const { mastra } = await import('../src/mastra/index.js');
  const result = await runProfile(argv, {
    env: process.env,
    mastra,
    readText: (path) => (path === STDIN_PATH ? stdinText : readFileSync(path, 'utf8')),
  });
  console.log(formatProfile(result.profile));
  console.log('');
  console.log(formatRunSummary(result));
};

main().catch((error: unknown) => {
  console.error(
    `pnpm run profile failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
