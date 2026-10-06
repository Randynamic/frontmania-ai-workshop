import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildArchiveIndex } from '../../../scripts/ingest/build-index.js';
import { createArchiveVector, loadArchiveTalks } from '../../data/archive.js';
import { createMockEmbeddingModel } from '../../data/embedding.js';
import {
  ArchiveHit,
  createSearchArchiveTool,
  DEFAULT_TOP_K,
  MAX_TOP_K,
  parseFilter,
  searchArchive,
  SearchArchiveInput,
  searchArchiveHits,
} from './search-archive.js';

/**
 * The committed data/archive.db is the live index (Vertex embedding, built on D-1), so this
 * test builds its own mock index in a temp file; the mock embedding matches it.
 */
const vectorStore = createArchiveVector(
  join(mkdtempSync(join(tmpdir(), 'archive-test-')), 'archive.db'),
);
const tool = createSearchArchiveTool({ vectorStore, model: createMockEmbeddingModel() });
const archiveTalks = loadArchiveTalks().talks;
const archiveIds = new Set(archiveTalks.map((talk) => talk.id));

beforeAll(async () => {
  await buildArchiveIndex({
    store: vectorStore,
    model: createMockEmbeddingModel(),
    talks: archiveTalks,
    embeddingName: 'mock',
    mode: 'mock',
    isFixture: false,
  });
});

describe('searchArchive', () => {
  test('returns topK archive rows, best match first, with the stored metadata', async () => {
    // Act
    const hits = searchArchiveHits(
      await tool.execute({ queryText: 'accessibility design systems', topK: 3 }),
    );

    // Assert
    expect(hits).toHaveLength(3);
    for (const hit of hits) {
      expect(ArchiveHit.safeParse(hit).success).toBe(true);
      expect(archiveIds.has(hit.id)).toBe(true);
    }
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    expect(hits.map((h) => h.title).join(' ')).toMatch(/accessib|design system/i);
  });

  test('the string filter path is honoured (year >= 2024 keeps rows, year >= 2030 drops them)', async () => {
    const kept = searchArchiveHits(
      await tool.execute({
        queryText: 'accessibility',
        topK: 3,
        filter: JSON.stringify({ year: { $gte: 2024 } }),
      }),
    );
    const dropped = searchArchiveHits(
      await tool.execute({
        queryText: 'accessibility',
        topK: 3,
        filter: JSON.stringify({ year: { $gte: 2030 } }),
      }),
    );
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(0);
  });

  test('a bad filter or a bad input is an error a participant can read', async () => {
    expect(() => parseFilter('not json')).toThrow('filter is not JSON');
    expect(() => parseFilter('[1]')).toThrow('must be a JSON object');
    expect(parseFilter('{}')).toBeUndefined();
    expect(parseFilter(undefined)).toBeUndefined();
    await expect(tool.execute({ queryText: 'x', topK: 3, filter: 'nope' })).rejects.toThrow(
      'filter is not JSON',
    );
    const invalid = await tool.execute({ queryText: '', topK: MAX_TOP_K + 1 });
    expect(() => searchArchiveHits(invalid)).toThrow('validation failed');
    expect(() => searchArchiveHits({ nope: true })).toThrow('unexpected shape');
  });

  test('input schema defaults topK and keeps filter optional; the default export resolves lazily', () => {
    expect(SearchArchiveInput.parse({ queryText: 'q' })).toEqual({
      queryText: 'q',
      topK: DEFAULT_TOP_K,
    });
    expect(searchArchive.id).toBe('searchArchive');
    expect(searchArchive.description).toMatch(/earlier Frontmania editions/);
  });
});
