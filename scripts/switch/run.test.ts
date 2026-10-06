import { describe, expect, test } from 'vitest';
import { stashMessage, switchBranch, USAGE, type Git } from './run.js';

interface FakeRepo {
  readonly git: Git;
  readonly calls: string[][];
}

const fakeRepo = (options: {
  readonly current: string;
  readonly status?: string;
  readonly checkoutError?: string;
}): FakeRepo => {
  const calls: string[][] = [];
  const git: Git = (args) => {
    calls.push([...args]);
    if (args[0] === 'branch') return `${options.current}\n`;
    if (args[0] === 'status') return options.status ?? '';
    if (args[0] === 'checkout' && options.checkoutError) throw new Error(options.checkoutError);
    return '';
  };
  return { git, calls };
};

describe('switchBranch', () => {
  test('stashes edited exercise files, then checks out the done branch', () => {
    // Arrange
    const repo = fakeRepo({ current: '01-start', status: ' M src/schemas/profile.ts\n' });

    // Act
    const result = switchBranch(['01-done'], repo.git);

    // Assert
    expect(repo.calls).toEqual([
      ['branch', '--show-current'],
      ['status', '--porcelain'],
      ['stash', 'push', '--include-untracked', '-m', stashMessage('01-start', '01-done')],
      ['checkout', '01-done'],
    ]);
    expect(result.stashed).toBe(true);
    expect(result.lines.join('\n')).toContain('git stash pop');
    expect(result.lines.at(-1)).toBe('now on 01-done');
  });

  test('a clean tree checks out without a stash', () => {
    const repo = fakeRepo({ current: '01-done' });
    const result = switchBranch(['02-start'], repo.git);
    expect(repo.calls.map((c) => c[0])).toEqual(['branch', 'status', 'checkout']);
    expect(result).toMatchObject({ stashed: false, lines: ['now on 02-start'] });
  });

  test('the current branch is a no-op', () => {
    const repo = fakeRepo({ current: '02-start', status: ' M x' });
    expect(switchBranch(['02-start'], repo.git).lines).toEqual([
      'already on 02-start; nothing to do',
    ]);
    expect(repo.calls).toHaveLength(1);
  });

  test('a failed checkout after a stash says how to get the work back', () => {
    const repo = fakeRepo({ current: '01-start', status: '?? notes.md', checkoutError: 'boom' });
    expect(() => switchBranch(['01-done'], repo.git)).toThrow(
      /git checkout 01-done failed: boom; .*git stash pop.* on 01-start/,
    );
  });

  test('rejects anything that is not a workshop branch, and a missing argument', () => {
    const repo = fakeRepo({ current: '01-start' });
    expect(() => switchBranch(['main'], repo.git)).toThrow('main is not a workshop branch');
    expect(() => switchBranch([], repo.git)).toThrow(USAGE);
    expect(repo.calls).toHaveLength(0);
  });
});
