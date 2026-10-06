import { TokenTallyExporter } from '../src/observability/token-tally.js';
import {
  formatChanges,
  formatPlan,
  formatRunSummary,
  formatTopPicks,
  runPlan,
} from './plan/run.js';

/**
 * pnpm plan [--profile <json> | --cv <file>]
 *
 * Builds its own Mastra instance (inside main, so a missing key is one
 * readable line) with a token tally exporter next to the OTLP exporter.
 */
const main = async (): Promise<void> => {
  const { AGENTS, createMastra, WORKFLOWS } = await import('../src/mastra/index.js');
  const tally = new TokenTallyExporter();
  const mastra = createMastra(process.env, {
    agents: AGENTS,
    workflows: WORKFLOWS,
    exporters: [tally],
  });
  const result = await runPlan(process.argv.slice(2), { env: process.env, mastra, tally });
  console.log(formatPlan(result.plan));
  console.log('');
  console.log(formatTopPicks(result.topPicks));
  const changes = formatChanges(result.previousTopPicks, result.topPicks);
  if (changes) console.log(changes);
  console.log(formatRunSummary(result));
};

main().catch((error: unknown) => {
  console.error(`pnpm plan failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
