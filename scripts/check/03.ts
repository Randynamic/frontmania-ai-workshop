/**
 * pnpm check:03 [--static]
 *
 * Done criterion of exercise 3. The static layer inspects the tool and the
 * planner and runs the two-turn `pnpm ask` offline (MODEL_MODE=mock is
 * forced below, before any src module loads: scripted mock planner, feedback
 * kept in memory); the live layer reads the last `pnpm ask` run and asks the
 * backend for the three feedback rows on its trace.
 */
process.env.MODEL_MODE = 'mock';

const { main } = await import('./03/main.js');
main(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`check:03 crashed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
