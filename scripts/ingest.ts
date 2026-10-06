import { writeFileSync } from 'node:fs';
import { createArchiveVector, loadArchiveTalks } from '../src/data/archive.js';
import {
  createEmbeddingModel,
  embeddingModeFrom,
  MOCK_EMBEDDING_ID,
  tokenize,
} from '../src/data/embedding.js';
import { DATA_PATHS } from '../src/data/paths.js';
import { buildArchiveIndex } from './ingest/build-index.js';

/**
 * pnpm ingest [--fixture] [--dry-run] [--db <path>] [--manifest <path>]
 *
 * Rebuilds data/archive.db (index "archive") from data/archive/*.json, or from
 * the fixture with --fixture, and writes data/archive-manifest.json. Live mode
 * embeds through the proxy alias EMBED_MODEL; MODEL_MODE=mock uses the
 * deterministic hash embedding (no network). --dry-run prints counts and an
 * estimated token count and touches nothing. Exit 1 on any failure.
 */

const JSON_INDENT = 2;

interface Args {
  readonly fixture: boolean;
  readonly dryRun: boolean;
  readonly db: string;
  readonly manifest: string;
}

const parseArgs = (argv: readonly string[]): Args => {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    fixture: argv.includes('--fixture'),
    dryRun: argv.includes('--dry-run'),
    db: value('--db') ?? DATA_PATHS.archiveDb,
    manifest: value('--manifest') ?? DATA_PATHS.archiveManifest,
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const mode = embeddingModeFrom(process.env);
  const embeddingName =
    mode === 'mock' ? MOCK_EMBEDDING_ID : (process.env.EMBED_MODEL ?? 'talk-picker-embed');
  const archive = loadArchiveTalks({ forceFixture: args.fixture });

  console.log(`source: ${archive.paths.join(', ')}${archive.isFixture ? ' (fixture)' : ''}`);
  console.log(`talks: ${archive.talks.length}  mode: ${mode}  embedding: ${embeddingName}`);

  if (args.dryRun) {
    const estimatedTokens = archive.talks.reduce(
      (sum, talk) => sum + tokenize(`${talk.title} ${talk.abstract}`).length,
      0,
    );
    console.log(
      `dry run: would embed ${archive.talks.length} texts, about ${estimatedTokens} tokens`,
    );
    return;
  }

  const store = createArchiveVector(args.db);
  try {
    const { manifest, tokens } = await buildArchiveIndex({
      store,
      model: createEmbeddingModel(process.env),
      talks: archive.talks,
      embeddingName,
      mode,
      isFixture: archive.isFixture,
    });
    writeFileSync(args.manifest, `${JSON.stringify(manifest, null, JSON_INDENT)}\n`, 'utf8');
    console.log(
      `index "${manifest.index}": ${manifest.rows} rows, dimension ${manifest.dimension}, ${tokens} tokens`,
    );
    console.log(`written: ${args.db}, ${args.manifest}`);
  } finally {
    await store.close();
  }
};

main().catch((error: unknown) => {
  console.error(`ingest failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
