import type { ParsedArgs } from './args.js';

export type DeletionMode = 'dry-run' | 'execute';

/**
 * Dry run is the default. `--execute` deletes; `--dry-run` always wins, so
 * passing both flags deletes nothing.
 */
export const deletionMode = (args: ParsedArgs): DeletionMode =>
  args.flags['execute'] === true && args.flags['dry-run'] !== true ? 'execute' : 'dry-run';
