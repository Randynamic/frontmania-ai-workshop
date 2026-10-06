/**
 * pnpm check:02 [--static]
 *
 * Done criterion of exercise 2. The static layer runs the participant's
 * workflow offline (MODEL_MODE=mock is forced below, before any src module
 * loads: mock model, seed prompts, committed vector index); the live layer
 * reads the last `pnpm plan` run and asks the backend for its trace.
 */
process.env.MODEL_MODE = 'mock';

const { main } = await import('./02/main.js');
main(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`check:02 crashed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
