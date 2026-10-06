import { describe, expect, test } from 'vitest';
import { ArchiveManifest, ARCHIVE_INDEX, createArchiveVector } from '../../src/data/archive.js';
import { createMockEmbeddingModel, hashEmbedding } from '../../src/data/embedding.js';
import type { ArchiveTalk } from '../../src/schemas/talk.js';
import { buildArchiveIndex } from './build-index.js';

const talk = (id: string, title: string, abstract: string, year = 2025): ArchiveTalk => ({
  id,
  year,
  title,
  speakers: ['Fictional Speaker'],
  abstract,
  room: 'Quest',
  videoUrl: null,
});

const TALKS = [
  talk(
    'fm25-a',
    'Container queries in production',
    'Responsive components with container queries and CSS.',
  ),
  talk(
    'fm25-b',
    'Tracing front-end apps',
    'OpenTelemetry tracing and observability for web applications.',
  ),
  talk('fm24-c', 'Signals compared', 'Signals in Angular, Preact and the platform proposal.', 2024),
];

const DIMENSION = 64;

const memoryStore = () => createArchiveVector(':memory:');

describe('buildArchiveIndex', () => {
  test('creates the index, upserts one row per talk and returns a valid manifest', async () => {
    // Arrange
    const store = memoryStore();
    const now = () => new Date('2026-09-26T12:00:00Z');

    // Act
    const result = await buildArchiveIndex({
      store,
      model: createMockEmbeddingModel(DIMENSION),
      talks: TALKS,
      embeddingName: 'mock-hash-v1',
      mode: 'mock',
      isFixture: true,
      now,
    });

    // Assert
    expect(ArchiveManifest.safeParse(result.manifest).success).toBe(true);
    expect(result.manifest).toMatchObject({
      index: ARCHIVE_INDEX,
      dimension: DIMENSION,
      rows: 3,
      years: [2024, 2025],
      builtAt: '2026-09-26T12:00:00.000Z',
    });
    expect(result.tokens).toBeGreaterThan(0);
    expect(await store.describeIndex({ indexName: ARCHIVE_INDEX })).toEqual({
      dimension: DIMENSION,
      count: 3,
      metric: 'cosine',
    });
    await store.close();
  });

  test('a lexical query returns the matching talk first with its metadata', async () => {
    // Arrange
    const store = memoryStore();
    await buildArchiveIndex({
      store,
      model: createMockEmbeddingModel(DIMENSION),
      talks: TALKS,
      embeddingName: 'mock-hash-v1',
      mode: 'mock',
      isFixture: true,
    });

    // Act
    const hits = await store.query({
      indexName: ARCHIVE_INDEX,
      queryVector: hashEmbedding('observability tracing OpenTelemetry', DIMENSION),
      topK: 2,
    });

    // Assert
    expect(hits[0]?.id).toBe('fm25-b');
    expect(hits[0]?.metadata).toMatchObject({ id: 'fm25-b', year: 2025, videoUrl: null });
    expect(hits[0]?.metadata?.text).toContain('Tracing front-end apps');
    await store.close();
  });

  test('filters by year with $gte and rebuilds idempotently', async () => {
    // Arrange
    const store = memoryStore();
    const input = {
      store,
      model: createMockEmbeddingModel(DIMENSION),
      talks: TALKS,
      embeddingName: 'mock-hash-v1',
      mode: 'mock' as const,
      isFixture: true,
    };
    await buildArchiveIndex(input);

    // Act
    await buildArchiveIndex(input);
    const hits = await store.query({
      indexName: ARCHIVE_INDEX,
      queryVector: hashEmbedding('signals', DIMENSION),
      topK: 5,
      filter: { year: { $gte: 2025 } },
    });

    // Assert
    expect((await store.describeIndex({ indexName: ARCHIVE_INDEX })).count).toBe(3);
    expect(hits.map((h) => h.id)).not.toContain('fm24-c');
    await store.close();
  });

  test('rejects empty input and duplicate ids', async () => {
    const store = memoryStore();
    const base = {
      store,
      model: createMockEmbeddingModel(DIMENSION),
      embeddingName: 'mock-hash-v1',
      mode: 'mock' as const,
      isFixture: true,
    };
    await expect(buildArchiveIndex({ ...base, talks: [] })).rejects.toThrow(/no archive talks/);
    await expect(buildArchiveIndex({ ...base, talks: [TALKS[0]!, TALKS[0]!] })).rejects.toThrow(
      /duplicate archive id fm25-a/,
    );
    await store.close();
  });
});
