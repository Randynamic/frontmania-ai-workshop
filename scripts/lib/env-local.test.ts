import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from '../../src/data/paths.js';
import { ENV_LOCAL_FILE, loadEnvLocal } from './env-local.js';

const PRELOAD = resolve(REPO_ROOT, 'scripts/lib/preload-env-local.ts');
const SPAWN_TIMEOUT_MS = 30_000;

describe('loadEnvLocal', () => {
  test('loads the file into the environment when it exists', () => {
    // Arrange
    const loaded: string[] = [];
    const deps = {
      path: '/repo/.env.local',
      fileExists: () => true,
      loadEnvFile: (path: string) => {
        loaded.push(path);
      },
    };

    // Act
    const result = loadEnvLocal(deps);

    // Assert
    expect(result).toEqual({ loaded: true, path: '/repo/.env.local' });
    expect(loaded).toEqual(['/repo/.env.local']);
  });

  test('skips silently when the file is missing (the slip variant never creates it)', () => {
    // Arrange
    const deps = {
      path: '/repo/.env.local',
      fileExists: () => false,
      loadEnvFile: () => {
        throw new Error('must not be called');
      },
    };

    // Act
    const result = loadEnvLocal(deps);

    // Assert
    expect(result).toEqual({ loaded: false, path: '/repo/.env.local' });
  });

  test('names the file and the cause when it exists but cannot be loaded', () => {
    // Arrange
    const deps = {
      path: '/repo/.env.local',
      fileExists: () => true,
      loadEnvFile: () => {
        throw new Error('EACCES: permission denied');
      },
    };

    // Act + Assert
    expect(() => loadEnvLocal(deps)).toThrow(/\.env\.local.*EACCES: permission denied/);
  });

  test('ENV_LOCAL_FILE is the git-ignored name .env.example points to', () => {
    expect(ENV_LOCAL_FILE).toBe('.env.local');
  });
});

describe('preload-env-local through node --import', () => {
  test('prints no "not found" notice and exits 0, with or without .env.local', () => {
    // Arrange
    const args = ['--import', 'tsx', '--import', PRELOAD, '-e', 'console.log("ran")'];

    // Act
    const output = execFileSync(process.execPath, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: SPAWN_TIMEOUT_MS,
    });

    // Assert
    expect(output.trim()).toBe('ran');
    expect(output).not.toMatch(/not found/i);
  });
});
