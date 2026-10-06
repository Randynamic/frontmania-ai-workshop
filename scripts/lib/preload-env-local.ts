import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV_LOCAL_FILE, loadEnvLocal } from './env-local.js';

/**
 * Preload for the participant scripts:
 * `node --env-file-if-exists=.env --import tsx --import ./scripts/lib/preload-env-local.ts <script>`.
 * Runs before the entry module and everything it imports, so modules that
 * read process.env at import time (src/mastra/index.ts) see `.env.local`.
 */
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

loadEnvLocal({
  path: resolve(REPO_ROOT, ENV_LOCAL_FILE),
  fileExists: existsSync,
  loadEnvFile: (path) => process.loadEnvFile(path),
});
