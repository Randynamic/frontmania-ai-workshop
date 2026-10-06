import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LibSQLVector } from '@mastra/libsql';
import { z } from 'zod';
import { ArchiveFile, type ArchiveTalk } from '../schemas/talk.js';
import { createEmbeddingModel, MOCK_EMBEDDING_DIMENSION } from './embedding.js';
import { readJsonFile } from './json-file.js';
import { DATA_PATHS } from './paths.js';

/** Index name inside data/archive.db; one row per archive abstract. */
export const ARCHIVE_INDEX = 'archive';

/** Metadata stored next to every vector; what searchArchive returns to the model. */
export const ArchiveRowMetadata = z.object({
  id: z.string(),
  year: z.number().int(),
  title: z.string(),
  speakers: z.array(z.string()),
  room: z.string().optional(),
  videoUrl: z.string().nullable(),
  text: z.string(),
});
export type ArchiveRowMetadata = z.infer<typeof ArchiveRowMetadata>;

/** Written by pnpm ingest; says which embedding built the committed index. */
export const ArchiveManifest = z.object({
  index: z.literal(ARCHIVE_INDEX),
  dimension: z.number().int().positive(),
  /** Model alias for live builds, MOCK_EMBEDDING_ID for offline builds. */
  embedding: z.string().min(1),
  mode: z.enum(['live', 'mock']),
  fixture: z.boolean(),
  rows: z.number().int().positive(),
  years: z.array(z.number().int()).min(1),
  builtAt: z.string().datetime(),
});
export type ArchiveManifest = z.infer<typeof ArchiveManifest>;

export const readArchiveManifest = (path: string = DATA_PATHS.archiveManifest): ArchiveManifest =>
  readJsonFile(path, ArchiveManifest);

export const createArchiveVector = (dbPath: string = DATA_PATHS.archiveDb): LibSQLVector =>
  new LibSQLVector({ id: 'archive', url: `file:${dbPath}` });

/** Lazily created so importing this module never touches the file. */
let cachedVector: LibSQLVector | undefined;
export const archiveVector = (): LibSQLVector => {
  cachedVector ??= createArchiveVector();
  return cachedVector;
};

const isArchiveFileName = (name: string): boolean => /^\d{4}\.json$/.test(name);

export interface LoadedArchive {
  readonly files: readonly ArchiveFile[];
  readonly talks: readonly ArchiveTalk[];
  readonly isFixture: boolean;
  readonly paths: readonly string[];
}

/**
 * Every data/archive/<year>.json, or the fixture when the directory has none
 * (or when `forceFixture` is set). The fixture is one year only.
 */
export const loadArchiveTalks = (
  options: {
    readonly archiveDir?: string;
    readonly fixture?: string;
    readonly forceFixture?: boolean;
  } = {},
): LoadedArchive => {
  const archiveDir = options.archiveDir ?? DATA_PATHS.archiveDir;
  const fixturePath = options.fixture ?? DATA_PATHS.archiveFixture;
  const realPaths = existsSync(archiveDir)
    ? readdirSync(archiveDir)
        .filter(isArchiveFileName)
        .sort()
        .map((name) => resolve(archiveDir, name))
    : [];
  const useFixture = options.forceFixture === true || realPaths.length === 0;
  const paths = useFixture ? [fixturePath] : realPaths;
  const files = paths.map((path) => readJsonFile(path, ArchiveFile));
  return {
    files,
    talks: files.flatMap((file) => file.talks),
    isFixture: useFixture || files.some((file) => file.fixture),
    paths,
  };
};

/** The text that is embedded per archive talk; the same string is stored as metadata.text. */
export const archiveTalkText = (talk: ArchiveTalk): string =>
  `${talk.title}\n${talk.speakers.join(', ')}\n\n${talk.abstract}`;

export const toArchiveRow = (talk: ArchiveTalk): ArchiveRowMetadata => ({
  id: talk.id,
  year: talk.year,
  title: talk.title,
  speakers: [...talk.speakers],
  ...(talk.room !== undefined ? { room: talk.room } : {}),
  videoUrl: talk.videoUrl,
  text: archiveTalkText(talk),
});

/**
 * The embedding model that matches the committed index: in mock mode its
 * dimension comes from the manifest so queries always fit the index.
 */
export const embeddingModelForArchive = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  manifestPath: string = DATA_PATHS.archiveManifest,
) => {
  const dimension = existsSync(manifestPath)
    ? readArchiveManifest(manifestPath).dimension
    : MOCK_EMBEDDING_DIMENSION;
  return createEmbeddingModel(env, dimension);
};
