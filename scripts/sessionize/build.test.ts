import { describe, expect, test } from 'vitest';
import { ArchiveFile, ProgramFile } from '../../src/schemas/talk.js';
import {
  abstractStats,
  buildArchive,
  buildProgram,
  median,
  programStats,
  sessionizeUrl,
  talkId,
  wordCount,
} from './build.js';
import type { SessionizeSession } from './parse.js';

const session = (
  sessionId: string,
  startTime: string,
  abstract = 'one two three',
): SessionizeSession => ({
  sessionId,
  title: `Talk ${sessionId}`,
  speakers: ['Someone'],
  abstract,
  room: 'Quest',
  startUtc: '2026-10-07T12:15:00.000Z',
  endUtc: '2026-10-07T13:00:00.000Z',
  startTime,
  durationMin: 45,
});

const meta = {
  year: 2026,
  event: 'Frontmania 2026',
  source: sessionizeUrl('gx2dpiu7'),
  snapshotAt: '2026-09-26T10:00:00.000Z',
};

describe('buildProgram', () => {
  test('keeps afternoon sessions with their slot and reports the rest as excluded', () => {
    // Arrange
    const sessions = [
      session('1', '11:00'),
      session('2', '14:15'),
      session('3', '14:40'),
      session('4', '15:30'),
      session('5', '16:30'),
    ];

    // Act
    const built = buildProgram(sessions, meta);

    // Assert
    expect(ProgramFile.safeParse(built.file).success).toBe(true);
    expect(built.file.fixture).toBe(false);
    expect(built.file.talks.map((t) => [t.id, t.slot])).toEqual([
      ['fm26-2', '14:15'],
      ['fm26-3', '14:15'],
      ['fm26-4', '15:30'],
      ['fm26-5', '16:30'],
    ]);
    expect(built.excluded.map((s) => s.sessionId)).toEqual(['1']);
  });

  test('does not mutate the sessions it receives', () => {
    // Arrange
    const sessions = [session('2', '14:15')];
    const before = JSON.stringify(sessions);

    // Act
    buildProgram(sessions, meta);

    // Assert
    expect(JSON.stringify(sessions)).toBe(before);
  });
});

describe('buildArchive', () => {
  test('keeps every session, sets videoUrl null and the year prefix', () => {
    // Act
    const file = buildArchive([session('9', '11:00'), session('10', '15:45')], {
      ...meta,
      year: 2025,
      event: 'Frontmania 2025',
    });

    // Assert
    expect(ArchiveFile.safeParse(file).success).toBe(true);
    expect(file.talks.map((t) => t.id)).toEqual(['fm25-9', 'fm25-10']);
    expect(file.talks.every((t) => t.videoUrl === null)).toBe(true);
  });
});

describe('stats', () => {
  test('counts words, median and talks per slot', () => {
    // Arrange
    const built = buildProgram(
      [
        session('1', '14:15', 'a b'),
        session('2', '15:30', 'a b c d'),
        session('3', '16:30', 'a b c'),
      ],
      meta,
    );

    // Act
    const stats = programStats(built);

    // Assert
    expect(stats).toEqual({
      count: 3,
      words: 9,
      medianWords: 3,
      sessionsInEmbed: 3,
      excluded: 0,
      perSlot: { '14:15': 1, '15:30': 1, '16:30': 1 },
    });
  });

  test('median handles even and empty inputs', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(abstractStats([])).toEqual({ count: 0, words: 0, medianWords: 0 });
    expect(wordCount('  two   words \n')).toBe(2);
  });

  test('talk ids and urls follow the frozen pattern', () => {
    expect(talkId(2026, '1249439')).toBe('fm26-1249439');
    expect(sessionizeUrl('abc')).toBe('https://sessionize.com/api/v2/abc/view/Sessions?under=true');
  });
});
