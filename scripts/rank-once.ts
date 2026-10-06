import {
  parseRankOnceArgs,
  rankOnce,
  renderPromptSource,
  renderRankerPrompt,
} from './rank-once/run.js';

const main = async (): Promise<void> => {
  const args = parseRankOnceArgs(process.argv.slice(2));
  if (args.renderOnly) {
    // No model call, so no key needed; stdout stays byte-exact for the contract test.
    const source = renderPromptSource(process.env);
    if (source.note) console.error(source.note);
    process.stdout.write(await renderRankerPrompt(args.profile, args.slot, source.load));
    return;
  }
  const { mastra } = await import('../src/mastra/index.js');
  const ranking = await rankOnce(args.profile, args.slot, mastra);
  await mastra.shutdown();
  console.log(JSON.stringify(ranking, null, 2));
};

main().catch((error: unknown) => {
  console.error(`pnpm rank-once failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
