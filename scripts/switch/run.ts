/**
 * pnpm run switch <branch>
 *
 * The stuck rule and the block changes in one command: if the working tree
 * has changes, `git stash push --include-untracked` keeps them (git-ignored
 * files such as .env and .talk-picker/ stay where they are), then
 * `git checkout <branch>`. A plain `git checkout 01-done` refuses to run
 * over edited exercise files; this does not. Your work stays in
 * `git stash list`; `git stash pop` on the branch you left brings it back.
 */
export const WORKSHOP_BRANCHES = [
  '00-setup',
  '01-start',
  '01-done',
  '02-start',
  '02-done',
  '03-start',
  '03-done',
  'final',
] as const;
export type WorkshopBranch = (typeof WORKSHOP_BRANCHES)[number];

export const USAGE = `usage: pnpm run switch <branch>   (${WORKSHOP_BRANCHES.join(', ')})`;

/** Runs git with the given arguments and returns stdout; throws with git's message on a non-zero exit. */
export type Git = (args: readonly string[]) => string;

export interface SwitchResult {
  readonly from: string;
  readonly to: WorkshopBranch;
  readonly stashed: boolean;
  readonly lines: readonly string[];
}

export const parseTarget = (argv: readonly string[]): WorkshopBranch => {
  const target = argv.find((arg) => !arg.startsWith('-'));
  if (!target) throw new Error(USAGE);
  if (!(WORKSHOP_BRANCHES as readonly string[]).includes(target)) {
    throw new Error(`${target} is not a workshop branch\n${USAGE}`);
  }
  return target as WorkshopBranch;
};

export const stashMessage = (from: string, to: string): string =>
  `talk-picker: work on ${from} before switching to ${to}`;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message.trim() : String(error);

export const switchBranch = (argv: readonly string[], git: Git): SwitchResult => {
  const to = parseTarget(argv);
  const from = git(['branch', '--show-current']).trim() || '(detached HEAD)';
  if (from === to) {
    return { from, to, stashed: false, lines: [`already on ${to}; nothing to do`] };
  }
  const stashed = git(['status', '--porcelain']).trim().length > 0;
  if (stashed) git(['stash', 'push', '--include-untracked', '-m', stashMessage(from, to)]);
  try {
    git(['checkout', to]);
  } catch (error) {
    const restore = stashed
      ? `; your changes are safe in the stash: run \`git stash pop\` to get them back on ${from}`
      : '';
    throw new Error(`git checkout ${to} failed: ${errorText(error)}${restore}`, {
      cause: error,
    });
  }
  const lines = [
    ...(stashed
      ? [
          `stashed your changes on ${from} (\`git stash list\` shows them; \`git stash pop\` on ${from} brings them back)`,
        ]
      : []),
    `now on ${to}`,
  ];
  return { from, to, stashed, lines };
};
