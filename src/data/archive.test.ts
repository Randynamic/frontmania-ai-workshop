import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  archiveTalkText,
  archiveVector,
  ARCHIVE_INDEX,
  embeddingModelForArchive,
  readArchiveManifest,
  toArchiveRow,
} from './archive.js';
import { MOCK_EMBEDDING_DIMENSION, MOCK_EMBEDDING_ID } from './embedding.js';
import { readJsonFile } from './json-file.js';
import { DATA_PATHS, pickRealOrFixture, REPO_ROOT } from './paths.js';
import { z } from 'zod';

const talk = {
  id: 'fm25-1',
  year: 2025,
  title: 'A title',
  speakers: ['One', 'Two'],
  abstract: 'The abstract.',
  videoUrl: null,
};

describe('archive rows', () => {
  test('embeds title, speakers and abstract and stores the same text as metadata', () => {
    const text = archiveTalkText(talk);
    expect(text).toBe('A title\nOne, Two\n\nThe abstract.');
    expect(toArchiveRow(talk)).toEqual({
      id: 'fm25-1',
      year: 2025,
      title: 'A title',
      speakers: ['One', 'Two'],
      videoUrl: null,
      text,
    });
    expect(toArchiveRow({ ...talk, room: 'Quest' }).room).toBe('Quest');
  });

  test('archiveVector is created once and points at data/archive.db', async () => {
    const first = archiveVector();
    expect(archiveVector()).toBe(first);
    expect(await first.listIndexes()).toContain(ARCHIVE_INDEX);
  });
});

describe('embeddingModelForArchive', () => {
  test('mock model takes its dimension from the manifest', () => {
    const manifest = readArchiveManifest();
    const model = embeddingModelForArchive({ MODEL_MODE: 'mock' });
    expect(model.modelId).toBe(MOCK_EMBEDDING_ID);
    expect(manifest.index).toBe(ARCHIVE_INDEX);
  });

  test('falls back to the default dimension without a manifest', async () => {
    const model = embeddingModelForArchive({ MODEL_MODE: 'mock' }, '/nonexistent/manifest.json');
    const result = await model.doEmbed({ values: ['x'] });
    expect(result.embeddings[0]).toHaveLength(MOCK_EMBEDDING_DIMENSION);
  });
});

describe('paths and json files', () => {
  test('REPO_ROOT holds package.json and DATA_PATHS live under it', () => {
    expect(DATA_PATHS.program.startsWith(REPO_ROOT)).toBe(true);
    expect(pickRealOrFixture('/nonexistent', '/fixture')).toEqual({
      path: '/fixture',
      isFixture: true,
    });
    expect(pickRealOrFixture(DATA_PATHS.program, '/fixture').isFixture).toBe(false);
  });

  test('readJsonFile names the file and the failing path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'talk-picker-'));
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ count: 'three' }));
    expect(() => readJsonFile(file, z.object({ count: z.number() }))).toThrow(
      /bad\.json.*at count/,
    );
  });
});
