/**
 * pnpm check:01 [--static]
 *
 * Done criterion of exercise 1. The static layer runs the participant's
 * schema and agent offline (MODEL_MODE=mock is forced below, before any
 * src module loads, so no proxy key or network is needed); the live layer
 * reads the last `pnpm run profile` run and asks the backend for its trace.
 */
process.env.MODEL_MODE = 'mock';

const { main } = await import('./01/main.js');
main(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`check:01 crashed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
