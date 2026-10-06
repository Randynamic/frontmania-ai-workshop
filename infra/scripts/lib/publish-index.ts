import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveManifest } from '../../../src/data/archive.js';
import { MOCK_EMBEDDING_ID } from '../../../src/data/embedding.js';

/**
 * Commits the live-built archive index onto every checkpoint branch without a
 * checkout, merge or rebase: per branch, a temporary git index is read from the
 * branch tip, the two data files are replaced by the same blobs, and one new
 * commit is written on top. Every branch keeps its own history (the branches
 * are merge-derived, so a rebase would flatten them), and `data/` stays
 * byte-identical across all eight, so "done = next start + solution" holds.
 */

export const CHECKPOINT_BRANCHES = [
  '00-setup',
  '01-start',
  '01-done',
  '02-start',
  '02-done',
  '03-start',
  '03-done',
  'final',
] as const;

export const INDEX_FILES = ['data/archive.db', 'data/archive-manifest.json'] as const;
export const TAG_PREFIX = 'checkpoint/';
const FILE_MODE = '100644';

export type Git = (args: readonly string[], env?: Readonly<Record<string, string>>) => string;

export const gitIn =
  (repoDir: string): Git =>
  (args, env) =>
    execFileSync('git', [...args], {
      cwd: repoDir,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

/** Refuses anything but a live build; returns the parsed manifest. */
export const requireLiveManifest = (text: string): ArchiveManifest => {
  const parsed = ArchiveManifest.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new Error(`manifest does not match the schema: ${parsed.error.message}`);
  const manifest = parsed.data;
  if (manifest.mode !== 'live' || manifest.embedding === MOCK_EMBEDDING_ID) {
    throw new Error(
      `manifest says mode "${manifest.mode}", embedding "${manifest.embedding}"; run pnpm ingest with MODEL_MODE=live and a real PROXY_API_KEY first`,
    );
  }
  return manifest;
};

/** The index as the vector store reports it must agree with the manifest. */
export const requireIndexMatches = (
  manifest: ArchiveManifest,
  index: { readonly dimension: number; readonly count: number },
): void => {
  if (index.dimension !== manifest.dimension || index.count !== manifest.rows) {
    throw new Error(
      `archive.db has dimension ${index.dimension} and ${index.count} rows, manifest says ${manifest.dimension} and ${manifest.rows}; run pnpm ingest again`,
    );
  }
};

export interface PublishResult {
  readonly branch: string;
  readonly from: string;
  readonly to: string;
  readonly isUnchanged: boolean;
}

const commitOnBranch = (
  git: Git,
  branch: string,
  blobs: ReadonlyMap<string, string>,
  message: string,
): PublishResult => {
  const from = git(['rev-parse', `refs/heads/${branch}`]);
  const scratch = mkdtempSync(join(tmpdir(), 'publish-index-'));
  const env = { GIT_INDEX_FILE: join(scratch, 'index') };
  try {
    git(['read-tree', from], env);
    [...blobs].forEach(([path, blob]) =>
      git(['update-index', '--add', '--cacheinfo', `${FILE_MODE},${blob},${path}`], env),
    );
    const tree = git(['write-tree'], env);
    if (tree === git(['rev-parse', `${from}^{tree}`])) {
      return { branch, from, to: from, isUnchanged: true };
    }
    const to = git(['commit-tree', tree, '-p', from, '-m', `${message} (${branch})`]);
    git(['update-ref', `refs/heads/${branch}`, to, from]);
    return { branch, from, to, isUnchanged: false };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

/**
 * Writes the working-tree copies of INDEX_FILES as blobs, commits them on every
 * branch, and moves `checkpoint/<branch>` to the new tip. The caller's own
 * index is reset for the two paths so `git status` stays clean.
 */
export const publishIndex = (
  git: Git,
  options: { readonly branches: readonly string[]; readonly message: string },
): readonly PublishResult[] => {
  const blobs = new Map(INDEX_FILES.map((path) => [path, git(['hash-object', '-w', '--', path])]));
  const results = options.branches.map((branch) =>
    commitOnBranch(git, branch, blobs, options.message),
  );
  results.forEach(({ branch, to }) => git(['tag', '-f', `${TAG_PREFIX}${branch}`, to]));
  git(['reset', '-q', '--', ...INDEX_FILES]);
  return results;
};
