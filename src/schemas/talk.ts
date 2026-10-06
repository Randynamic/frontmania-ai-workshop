import { z } from 'zod';

/**
 * The three afternoon slots the workshop ranks. The programme loader buckets
 * Sessionize start times into these (14:15-15:29 -> 14:15, 15:30-16:29 ->
 * 15:30, 16:30 and later -> 16:30). Talks that start before 14:15 are not in
 * the programme file at all (see data/README.md).
 */
export const SLOTS = ['14:15', '15:30', '16:30'] as const;
export const Slot = z.enum(SLOTS);
export type Slot = z.infer<typeof Slot>;

/** Talk ids are `fm<yy>-<sessionize session id>`, frozen at snapshot time. */
export const TALK_ID_PATTERN = /^fm\d{2}-[a-z0-9-]+$/;
export const TalkId = z.string().regex(TALK_ID_PATTERN, 'talk id must look like fm26-1234567');

/** One session on the day the workshop ranks (outline schema plus startTime and year). */
export const Talk = z.object({
  id: TalkId,
  title: z.string().min(1),
  speakers: z.array(z.string().min(1)).min(1),
  slot: Slot,
  room: z.string().min(1),
  durationMin: z.number().int().positive(),
  abstract: z.string().min(1),
  /** Local start time on the event day, HH:MM, Europe/Amsterdam. */
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  year: z.number().int().min(2020).max(2100),
});
export type Talk = z.infer<typeof Talk>;

/** data/program-2026.json and its fixture share this exact shape. */
export const ProgramFile = z.object({
  event: z.string().min(1),
  source: z.string().url(),
  snapshotAt: z.string().datetime(),
  fixture: z.boolean(),
  slots: z.array(Slot).length(SLOTS.length),
  talks: z.array(Talk).min(1),
});
export type ProgramFile = z.infer<typeof ProgramFile>;

/** One earlier-edition session in the vector store; videoUrl stays null until the organiser agrees. */
export const ArchiveTalk = z.object({
  id: TalkId,
  year: z.number().int().min(2020).max(2100),
  title: z.string().min(1),
  speakers: z.array(z.string().min(1)).min(1),
  abstract: z.string().min(1),
  room: z.string().min(1).optional(),
  videoUrl: z.string().url().nullable(),
});
export type ArchiveTalk = z.infer<typeof ArchiveTalk>;

/** data/archive/<year>.json and data/fixtures/archive-<year>.json share this exact shape. */
export const ArchiveFile = z.object({
  year: z.number().int().min(2020).max(2100),
  source: z.string().url(),
  snapshotAt: z.string().datetime(),
  fixture: z.boolean(),
  talks: z.array(ArchiveTalk).min(1),
});
export type ArchiveFile = z.infer<typeof ArchiveFile>;
