import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ArchiveFile, ProgramFile, SLOTS, type Talk } from '../schemas/talk.js';
import { ArchiveManifest, loadArchiveTalks, readArchiveManifest } from './archive.js';
import { readJsonFile } from './json-file.js';
import { IDENTITY_KEYS, loadLabels, loadPersonas, PersonaProfile } from './personas.js';
import { DATA_PATHS } from './paths.js';
import { loadProgram } from './program.js';

/**
 * Every committed data file is validated here against its schema. These
 * tests are the contract the slides, the checks and the optimizer rely on.
 */

const MIN_CV_WORDS = 350;
const MAX_CV_WORDS = 600;
const PERSONA_COUNT = 5;
const FICTIONAL_MARKER = 'Fictional persona';
const MASKING_FIXTURE_CV = fileURLToPath(
  new URL('../observability/fixtures/fictional-cv.md', import.meta.url),
);
/** A handle that could resolve to a real account is personal data; fixtures use the -example suffix. */
const HANDLE_PATTERN = /(?:github\.com|linkedin\.com\/in)\/([a-z0-9-]+)/gi;

const readRaw = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const uniqueIds = (talks: readonly { id: string }[]): boolean =>
  new Set(talks.map((t) => t.id)).size === talks.length;

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

describe('programme files', () => {
  const real = readJsonFile(DATA_PATHS.program, ProgramFile);
  const fixture = readJsonFile(DATA_PATHS.programFixture, ProgramFile);

  test('the real snapshot validates, is not a fixture and has unique ids', () => {
    expect(real.fixture).toBe(false);
    expect(uniqueIds(real.talks)).toBe(true);
    expect(real.slots).toEqual([...SLOTS]);
  });

  test('the fixture validates, is marked fixture and has unique ids', () => {
    expect(fixture.fixture).toBe(true);
    expect(uniqueIds(fixture.talks)).toBe(true);
  });

  test('real file and fixture have identical top-level keys and talk keys', () => {
    expect(Object.keys(readRaw(DATA_PATHS.programFixture)).sort()).toEqual(
      Object.keys(readRaw(DATA_PATHS.program)).sort(),
    );
    const keysOf = (talk: Talk) => Object.keys(talk).sort();
    expect(keysOf(fixture.talks[0]!)).toEqual(keysOf(real.talks[0]!));
  });

  test('fixture keeps the same slot distribution as the snapshot', () => {
    const perSlot = (file: ProgramFile) =>
      SLOTS.map((slot) => file.talks.filter((t) => t.slot === slot).length);
    expect(perSlot(fixture)).toEqual(perSlot(real));
  });

  test('every talk starts inside its slot bucket', () => {
    const minutes = (hhmm: string) => {
      const [h = 0, m = 0] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    for (const talk of [...real.talks, ...fixture.talks]) {
      const start = minutes(talk.startTime);
      const slotStart = minutes(talk.slot);
      const next = SLOTS[SLOTS.indexOf(talk.slot) + 1];
      expect(start, talk.id).toBeGreaterThanOrEqual(slotStart);
      if (next) expect(start, talk.id).toBeLessThan(minutes(next));
    }
  });

  test('loadProgram prefers the real snapshot and reports fixtures', () => {
    const lines: string[] = [];
    const loaded = loadProgram(undefined, (line) => lines.push(line));
    expect(loaded.isFixture).toBe(false);
    expect(lines).toEqual([]);
    const viaFixture = loadProgram(
      { real: '/nonexistent/program.json', fixture: DATA_PATHS.programFixture },
      (line) => lines.push(line),
    );
    expect(viaFixture.isFixture).toBe(true);
    expect(lines[0]).toMatch(/using fixture/);
  });
});

describe('archive files', () => {
  const real = loadArchiveTalks();
  const fixture = loadArchiveTalks({ forceFixture: true });

  test('every data/archive/<year>.json validates with unique ids and no fixture flag', () => {
    expect(real.isFixture).toBe(false);
    expect(real.files.length).toBeGreaterThanOrEqual(1);
    expect(uniqueIds(real.talks)).toBe(true);
    for (const file of real.files) expect(file.talks.every((t) => t.year === file.year)).toBe(true);
  });

  test('the archive fixture validates and is marked fixture', () => {
    expect(fixture.isFixture).toBe(true);
    expect(uniqueIds(fixture.talks)).toBe(true);
    expect(ArchiveFile.safeParse(fixture.files[0]).success).toBe(true);
  });

  test('archive file and fixture share top-level keys and talk keys', () => {
    const realPath = real.paths[0]!;
    expect(Object.keys(readRaw(DATA_PATHS.archiveFixture)).sort()).toEqual(
      Object.keys(readRaw(realPath)).sort(),
    );
    expect(Object.keys(fixture.talks[0]!).sort()).toEqual(Object.keys(real.talks[0]!).sort());
  });

  test('falls back to the fixture when the archive directory is empty or missing', () => {
    const loaded = loadArchiveTalks({ archiveDir: '/nonexistent/archive' });
    expect(loaded.isFixture).toBe(true);
    expect(loaded.paths).toEqual([DATA_PATHS.archiveFixture]);
  });
});

describe('archive index', () => {
  test('data/archive.db exists and the manifest describes it', () => {
    expect(existsSync(DATA_PATHS.archiveDb)).toBe(true);
    const manifest = readArchiveManifest();
    expect(ArchiveManifest.safeParse(manifest).success).toBe(true);
    const archive = loadArchiveTalks({ forceFixture: manifest.fixture });
    expect(manifest.rows).toBe(archive.talks.length);
    expect(manifest.years).toEqual([...new Set(archive.talks.map((t) => t.year))].sort());
  });
});

describe('stats', () => {
  test('data/stats.json matches the committed snapshot', () => {
    const stats = readRaw(DATA_PATHS.stats) as {
      program: {
        count: number;
        perSlot: Record<string, number>;
        sessionsInEmbed: number;
        excluded: number;
      };
      archive: { count: number; year: number };
    };
    const program = readJsonFile(DATA_PATHS.program, ProgramFile);
    const archive = loadArchiveTalks();
    expect(stats.program.count).toBe(program.talks.length);
    expect(stats.program.sessionsInEmbed).toBe(stats.program.count + stats.program.excluded);
    for (const slot of SLOTS) {
      expect(stats.program.perSlot[slot]).toBe(program.talks.filter((t) => t.slot === slot).length);
    }
    expect(stats.archive.count).toBe(
      archive.files.find((f) => f.year === stats.archive.year)?.talks.length,
    );
  });
});

describe('personas', () => {
  const personas = loadPersonas();
  const labels = loadLabels();
  const program = readJsonFile(DATA_PATHS.program, ProgramFile);
  const fixture = readJsonFile(DATA_PATHS.programFixture, ProgramFile);

  const expectFictional = (cv: string, name: string) => {
    expect(cv, name).toContain(FICTIONAL_MARKER);
    expect(cv, name).toMatch(/@example\.org/);
    expect(cv, name).not.toMatch(/@(?!example\.org)[a-z0-9.-]+\.[a-z]{2,}/i);
    for (const [, handle] of cv.matchAll(HANDLE_PATTERN)) {
      expect(handle, `${name}: ${handle}`).toMatch(/-example$/);
    }
  };

  test('five persona CVs exist, are marked fictional, and are 350 to 600 words', () => {
    expect(personas).toHaveLength(PERSONA_COUNT);
    for (const persona of personas) {
      const cv = readFileSync(persona.cvPath, 'utf8');
      expectFictional(cv, persona.name);
      const words = wordCount(cv);
      expect(words, persona.name).toBeGreaterThanOrEqual(MIN_CV_WORDS);
      expect(words, persona.name).toBeLessThanOrEqual(MAX_CV_WORDS);
    }
  });

  test('the masking-test CV follows the same fictional conventions', () => {
    expectFictional(readFileSync(MASKING_FIXTURE_CV, 'utf8'), 'fictional-cv.md');
  });

  test('every persona profile validates and carries no identity field', () => {
    for (const persona of personas) {
      expect(PersonaProfile.safeParse(persona.profile).success, persona.name).toBe(true);
      for (const key of IDENTITY_KEYS)
        expect(persona.profile, persona.name).not.toHaveProperty(key);
    }
  });

  test('labels cover every persona once and every pick exists in the matching programme slot', () => {
    expect(labels.labels.map((l) => l.persona).sort()).toEqual(personas.map((p) => p.name));
    const inSlot = (file: ProgramFile, id: string, slot: string) =>
      file.talks.some((t) => t.id === id && t.slot === slot);
    for (const label of labels.labels) {
      for (const slot of SLOTS) {
        expect(inSlot(program, label.picks[slot], slot), `${label.persona} ${slot}`).toBe(true);
        expect(
          inSlot(fixture, label.fixturePicks[slot], slot),
          `${label.persona} fixture ${slot}`,
        ).toBe(true);
      }
    }
  });

  test('the profiles directory has no stray files', () => {
    for (const persona of personas) {
      expect(persona.profilePath).toBe(resolve(DATA_PATHS.profilesDir, `${persona.name}.json`));
    }
  });
});
