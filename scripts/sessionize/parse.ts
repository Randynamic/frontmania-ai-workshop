import { SLOTS, type Slot } from '../../src/schemas/talk.js';

/**
 * Parser for the Sessionize "Sessions" HTML embed (`?under=true`). The JSON
 * API is not enabled for the Frontmania events, so this is the only stable
 * source. Every session is one `<li id="sz-session-<id>">` block with
 * speakers, title, description, room and a `data-sztz` attribute that carries
 * the ISO start and end in UTC. Times are read from that attribute, never
 * from the printed text (2025 prints 12-hour, 2026 prints 24-hour).
 */

export const EVENT_TIME_ZONE = 'Europe/Amsterdam';
const MS_PER_MINUTE = 60_000;

export interface SessionizeSession {
  readonly sessionId: string;
  readonly title: string;
  readonly speakers: readonly string[];
  readonly abstract: string;
  readonly room: string;
  readonly startUtc: string;
  readonly endUtc: string;
  /** Local HH:MM in the event time zone. */
  readonly startTime: string;
  readonly durationMin: number;
}

const ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });

/** Turns the description markup into plain text: <br> to newline, other tags dropped. */
export const htmlToText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const collapseSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const toLocalTime = (isoUtc: string, timeZone = EVENT_TIME_ZONE): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoUtc));

const minutesBetween = (startUtc: string, endUtc: string): number =>
  Math.round((Date.parse(endUtc) - Date.parse(startUtc)) / MS_PER_MINUTE);

const SESSION_BLOCK = /<li id="sz-session-(\d+)"[\s\S]*?<\/dl>\s*<\/li>/g;
const TITLE = /<h3 class="sz-session__title">([\s\S]*?)<\/h3>/;
const DESCRIPTION = /<p class="sz-session__description">([\s\S]*?)<\/p>/;
const ROOM = /class="sz-session__room">([\s\S]*?)<\/div>/;
const TIME = /data-sztz="DayTime\|[^|]*\|([^|]+)\|([^"]+)"/;
const SPEAKER = /<li data-speakerid="[^"]*">\s*<a[^>]*>([\s\S]*?)<\/a>/g;

const required = (block: string, pattern: RegExp, field: string, sessionId: string): string => {
  const match = pattern.exec(block);
  if (!match?.[1]) throw new Error(`session ${sessionId}: missing ${field}`);
  return match[1];
};

const normaliseIso = (raw: string): string => new Date(raw).toISOString();

const parseBlock = (block: string, sessionId: string): SessionizeSession => {
  const timeMatch = TIME.exec(block);
  if (!timeMatch?.[1] || !timeMatch[2]) throw new Error(`session ${sessionId}: missing time`);
  const startUtc = normaliseIso(timeMatch[1]);
  const endUtc = normaliseIso(timeMatch[2]);
  const speakers = [...block.matchAll(SPEAKER)].map((m) =>
    collapseSpaces(decodeEntities(m[1] ?? '')),
  );
  if (speakers.length === 0) throw new Error(`session ${sessionId}: no speakers`);
  return {
    sessionId,
    title: collapseSpaces(decodeEntities(required(block, TITLE, 'title', sessionId))),
    speakers,
    abstract: htmlToText(required(block, DESCRIPTION, 'description', sessionId)),
    room: collapseSpaces(decodeEntities(required(block, ROOM, 'room', sessionId))),
    startUtc,
    endUtc,
    startTime: toLocalTime(startUtc),
    durationMin: minutesBetween(startUtc, endUtc),
  };
};

/** Parses every session block; throws on the first malformed block. */
export const parseSessions = (html: string): readonly SessionizeSession[] => {
  const sessions = [...html.matchAll(SESSION_BLOCK)].map((match) =>
    parseBlock(match[0], match[1] ?? ''),
  );
  if (sessions.length === 0) throw new Error('no sz-session blocks found in the embed');
  return sessions;
};

const toMinutes = (hhmm: string): number => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const SLOT_STARTS = SLOTS.map((slot) => ({ slot, minutes: toMinutes(slot) }));

/**
 * Buckets a local start time into a slot: 14:15-15:29 -> 14:15, 15:30-16:29 ->
 * 15:30, 16:30 and later -> 16:30. Undefined before 14:15 (not rankable).
 */
export const slotFor = (startTime: string): Slot | undefined => {
  const minutes = toMinutes(startTime);
  const bucket = [...SLOT_STARTS].reverse().find((entry) => minutes >= entry.minutes);
  return bucket?.slot;
};
