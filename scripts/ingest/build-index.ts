import { embedMany } from 'ai';
import type { LibSQLVector } from '@mastra/libsql';
import {
  ARCHIVE_INDEX,
  archiveTalkText,
  toArchiveRow,
  type ArchiveManifest,
} from '../../src/data/archive.js';
import type { EmbeddingModelV4 } from '../../src/data/embedding.js';
import type { ArchiveTalk } from '../../src/schemas/talk.js';

/** Keeps every proxy request small; the proxy caps request size per key. */
export const EMBED_BATCH_SIZE = 32;

export interface BuildIndexInput {
  readonly store: Pick<LibSQLVector, 'listIndexes' | 'deleteIndex' | 'createIndex' | 'upsert'>;
  readonly model: EmbeddingModelV4;
  readonly talks: readonly ArchiveTalk[];
  readonly embeddingName: string;
  readonly mode: ArchiveManifest['mode'];
  readonly isFixture: boolean;
  readonly now?: () => Date;
}

export interface BuildIndexResult {
  readonly manifest: ArchiveManifest;
  readonly tokens: number;
}

const chunk = <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

interface Embedded {
  readonly vectors: readonly (readonly number[])[];
  readonly tokens: number;
}

const embedAll = async (model: EmbeddingModelV4, texts: readonly string[]): Promise<Embedded> => {
  const batches = await Promise.all(
    chunk(texts, EMBED_BATCH_SIZE).map((values) => embedMany({ model, values: [...values] })),
  );
  return batches.reduce<Embedded>(
    (acc, batch) => ({
      vectors: [...acc.vectors, ...batch.embeddings],
      tokens: acc.tokens + (batch.usage?.tokens ?? 0),
    }),
    { vectors: [], tokens: 0 },
  );
};

const uniqueYears = (talks: readonly ArchiveTalk[]): readonly number[] =>
  [...new Set(talks.map((talk) => talk.year))].sort((a, b) => a - b);

const assertUniqueIds = (talks: readonly ArchiveTalk[]): void => {
  const seen = new Set<string>();
  for (const talk of talks) {
    if (seen.has(talk.id)) throw new Error(`duplicate archive id ${talk.id}`);
    seen.add(talk.id);
  }
};

/** Drops and recreates the index, embeds every talk, upserts, returns the manifest. */
export const buildArchiveIndex = async (input: BuildIndexInput): Promise<BuildIndexResult> => {
  if (input.talks.length === 0) throw new Error('no archive talks to ingest');
  assertUniqueIds(input.talks);
  const { vectors, tokens } = await embedAll(input.model, input.talks.map(archiveTalkText));
  const dimension = vectors[0]?.length ?? 0;
  if (dimension === 0) throw new Error('embedding model returned an empty vector');

  const existing = await input.store.listIndexes();
  if (existing.includes(ARCHIVE_INDEX)) await input.store.deleteIndex({ indexName: ARCHIVE_INDEX });
  await input.store.createIndex({ indexName: ARCHIVE_INDEX, dimension, metric: 'cosine' });
  await input.store.upsert({
    indexName: ARCHIVE_INDEX,
    ids: input.talks.map((talk) => talk.id),
    vectors: vectors.map((vector) => [...vector]),
    metadata: input.talks.map(toArchiveRow),
  });

  return {
    tokens,
    manifest: {
      index: ARCHIVE_INDEX,
      dimension,
      embedding: input.embeddingName,
      mode: input.mode,
      fixture: input.isFixture,
      rows: input.talks.length,
      years: [...uniqueYears(input.talks)],
      builtAt: (input.now ?? (() => new Date()))().toISOString(),
    },
  };
};
