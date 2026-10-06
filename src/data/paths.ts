import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved from this file so scripts work from any cwd. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DATA_DIR = resolve(REPO_ROOT, 'data');

export const DATA_PATHS = {
  program: resolve(DATA_DIR, 'program-2026.json'),
  programFixture: resolve(DATA_DIR, 'fixtures', 'program-2026.json'),
  archiveDir: resolve(DATA_DIR, 'archive'),
  archiveFixture: resolve(DATA_DIR, 'fixtures', 'archive-2025.json'),
  archiveDb: resolve(DATA_DIR, 'archive.db'),
  archiveManifest: resolve(DATA_DIR, 'archive-manifest.json'),
  stats: resolve(DATA_DIR, 'stats.json'),
  cvsDir: resolve(DATA_DIR, 'cvs'),
  profilesDir: resolve(DATA_DIR, 'cvs', 'profiles'),
  labels: resolve(DATA_DIR, 'cvs', 'labels.json'),
} as const;

/** The real snapshot when it is present, otherwise the fixture; tells the caller which. */
export const pickRealOrFixture = (
  realPath: string,
  fixturePath: string,
): { readonly path: string; readonly isFixture: boolean } =>
  existsSync(realPath)
    ? { path: realPath, isFixture: false }
    : { path: fixturePath, isFixture: true };
