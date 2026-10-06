import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from '../../src/data/paths.js';

/**
 * `profile` and `doctor` are names pnpm reserves for its own builtins:
 * `pnpm profile` exits with ERR_PNPM_NOT_IMPLEMENTED and never reaches
 * package.json. Every message a participant may copy from a script must say
 * `pnpm run profile` / `pnpm run doctor`.
 */
const SCRIPTS_DIR = resolve(REPO_ROOT, 'scripts');
const BUILTIN_COLLISION = /pnpm (profile|doctor)\b/g;

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(dir, name));

describe('pnpm builtin collisions', () => {
  test('no script says plain `pnpm profile` or `pnpm doctor`', () => {
    // Arrange
    const files = sourceFiles(SCRIPTS_DIR);
    expect(files.length).toBeGreaterThan(0);

    // Act
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(BUILTIN_COLLISION)].map((match) => `${file}: ${match[0]}`);
    });

    // Assert
    expect(offenders).toEqual([]);
  });
});
