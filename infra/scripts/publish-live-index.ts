import { existsSync, readFileSync, statSync } from 'node:fs';
import { createArchiveVector, ARCHIVE_INDEX } from '../../src/data/archive.js';
import { DATA_PATHS, REPO_ROOT } from '../../src/data/paths.js';
import {
  CHECKPOINT_BRANCHES,
  gitIn,
  publishIndex,
  requireIndexMatches,
  requireLiveManifest,
} from './lib/publish-index.js';

/**
 * Trainer only, D-1 runbook step 9. After `pnpm ingest` with MODEL_MODE=live
 * and the reserve key, run from the repo root:
 *
 *   node --import tsx infra/scripts/publish-live-index.ts            # dry run
 *   node --import tsx infra/scripts/publish-live-index.ts --execute  # commit on 8 branches, move tags
 *
 * then `git push --all && git push --force --tags`.
 */

const COMMIT_MESSAGE = 'data: live-built archive index';

const requireCheckpointedDb = (): void => {
  const wal = `${DATA_PATHS.archiveDb}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) {
    throw new Error(
      `${wal} is not empty; stop every process that has archive.db open and run pnpm ingest again`,
    );
  }
};

const main = async (): Promise<void> => {
  const isExecute = process.argv.includes('--execute');
  const manifest = requireLiveManifest(readFileSync(DATA_PATHS.archiveManifest, 'utf8'));
  requireCheckpointedDb();
  const store = createArchiveVector();
  try {
    requireIndexMatches(manifest, await store.describeIndex({ indexName: ARCHIVE_INDEX }));
  } finally {
    await store.close();
  }
  console.log(
    `index ok: ${manifest.embedding}, dimension ${manifest.dimension}, ${manifest.rows} rows, fixture ${manifest.fixture}`,
  );
  if (!isExecute) {
    console.log(`dry run: would commit on ${CHECKPOINT_BRANCHES.join(', ')}; add --execute`);
    return;
  }
  const results = publishIndex(gitIn(REPO_ROOT), {
    branches: CHECKPOINT_BRANCHES,
    message: COMMIT_MESSAGE,
  });
  results.forEach(({ branch, from, to, isUnchanged }) =>
    console.log(
      `${branch.padEnd(9)} ${isUnchanged ? 'unchanged' : `${from.slice(0, 8)} -> ${to.slice(0, 8)}`}`,
    ),
  );
  console.log('next: git push --all && git push --force --tags');
};

main().catch((error: unknown) => {
  console.error(`publish failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
