import {
  SLOTS,
  type ArchiveFile,
  type ArchiveTalk,
  type ProgramFile,
  type Slot,
  type Talk,
} from '../../src/schemas/talk.js';
import { slotFor, type SessionizeSession } from './parse.js';

/** Sessionize event ids for the two Frontmania editions (public embeds). */
export const SESSIONIZE_EVENTS = {
  program: { id: 'gx2dpiu7', year: 2026, event: 'Frontmania 2026' },
  archive: { id: 'ary2w1mc', year: 2025, event: 'Frontmania 2025' },
} as const;

export const sessionizeUrl = (eventId: string): string =>
  `https://sessionize.com/api/v2/${eventId}/view/Sessions?under=true`;

const yearPrefix = (year: number): string => `fm${String(year).slice(-2)}`;

export const talkId = (year: number, sessionId: string): string =>
  `${yearPrefix(year)}-${sessionId}`;

export interface BuildMeta {
  readonly year: number;
  readonly event: string;
  readonly source: string;
  readonly snapshotAt: string;
}

const toTalk = (session: SessionizeSession, slot: Slot, year: number): Talk => ({
  id: talkId(year, session.sessionId),
  title: session.title,
  speakers: [...session.speakers],
  slot,
  room: session.room,
  durationMin: session.durationMin,
  abstract: session.abstract,
  startTime: session.startTime,
  year,
});

export interface BuiltProgram {
  readonly file: ProgramFile;
  /** Sessions the embed lists that start before the first slot; listed in data/README.md. */
  readonly excluded: readonly SessionizeSession[];
}

/** Keeps only sessions that fall into a rankable slot; the rest is reported, not dropped silently. */
export const buildProgram = (
  sessions: readonly SessionizeSession[],
  meta: BuildMeta,
): BuiltProgram => {
  const withSlot = sessions.map((session) => ({ session, slot: slotFor(session.startTime) }));
  const talks = withSlot.flatMap(({ session, slot }) =>
    slot ? [toTalk(session, slot, meta.year)] : [],
  );
  const excluded = withSlot.filter(({ slot }) => slot === undefined).map(({ session }) => session);
  return {
    file: {
      event: meta.event,
      source: meta.source,
      snapshotAt: meta.snapshotAt,
      fixture: false,
      slots: [...SLOTS],
      talks,
    },
    excluded,
  };
};

const toArchiveTalk = (session: SessionizeSession, year: number): ArchiveTalk => ({
  id: talkId(year, session.sessionId),
  year,
  title: session.title,
  speakers: [...session.speakers],
  abstract: session.abstract,
  room: session.room,
  videoUrl: null,
});

/** Every session of an earlier edition goes into the archive; no slot filter there. */
export const buildArchive = (
  sessions: readonly SessionizeSession[],
  meta: BuildMeta,
): ArchiveFile => ({
  year: meta.year,
  source: meta.source,
  snapshotAt: meta.snapshotAt,
  fixture: false,
  talks: sessions.map((session) => toArchiveTalk(session, meta.year)),
});

export const wordCount = (text: string): number =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1] ?? 0;
  const high = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? (low + high) / 2 : high;
};

export interface AbstractStats {
  readonly count: number;
  readonly words: number;
  readonly medianWords: number;
}

export const abstractStats = (abstracts: readonly string[]): AbstractStats => {
  const counts = abstracts.map(wordCount);
  return {
    count: counts.length,
    words: counts.reduce((sum, n) => sum + n, 0),
    medianWords: median(counts),
  };
};

export interface ProgramStats extends AbstractStats {
  readonly sessionsInEmbed: number;
  readonly excluded: number;
  readonly perSlot: Readonly<Record<Slot, number>>;
}

export const programStats = (built: BuiltProgram): ProgramStats => {
  const perSlot = Object.fromEntries(
    SLOTS.map((slot) => [slot, built.file.talks.filter((t) => t.slot === slot).length]),
  ) as Record<Slot, number>;
  return {
    ...abstractStats(built.file.talks.map((t) => t.abstract)),
    sessionsInEmbed: built.file.talks.length + built.excluded.length,
    excluded: built.excluded.length,
    perSlot,
  };
};
