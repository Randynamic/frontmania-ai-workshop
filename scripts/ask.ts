import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { TokenTallyExporter } from '../src/observability/token-tally.js';
import { formatAskSummary, runAsk } from './ask/run.js';
import { promptVerdicts, type Verdict } from './ask/verdicts.js';

/**
 * pnpm ask "<question>" [--feedback "up:reason;down:reason;up:reason"]
 *
 * Prints the planner's plan, asks for a thumb and a reason per slot (or
 * takes them from --feedback), and lets the agent submit them.
 */
const askInTerminal = async (): Promise<readonly Verdict[]> => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await promptVerdicts(
      (prompt) => rl.question(prompt),
      (message) => console.log(message),
    );
  } finally {
    rl.close();
  }
};

const main = async (): Promise<void> => {
  const { AGENTS, createMastra, WORKFLOWS } = await import('../src/mastra/index.js');
  const tally = new TokenTallyExporter();
  const mastra = createMastra(process.env, {
    agents: AGENTS,
    workflows: WORKFLOWS,
    exporters: [tally],
  });
  const result = await runAsk(process.argv.slice(2), {
    env: process.env,
    mastra,
    tally,
    onAnswer: (answer) => console.log(`${answer}\n`),
    // Without a terminal runAsk fails before turn 1 unless --feedback is given: no model calls spent.
    ...(stdin.isTTY ? { askVerdicts: askInTerminal } : {}),
  });
  console.log(`\n${result.confirmation}\n`);
  console.log(formatAskSummary(result));
};

main().catch((error: unknown) => {
  console.error(`pnpm ask failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
