import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { Slot } from '../../../src/schemas/talk.js';

/** Public fields of the programme the blind-pick page shows; the file schema itself belongs to the data engineer. */
const PublicTalk = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  slot: Slot,
  speakers: z.array(z.string()).default([]),
  room: z.string().optional(),
});
const PublicProgram = z.object({
  event: z.string().optional(),
  fixture: z.boolean().default(false),
  slots: z.array(Slot).default([...Slot.options]),
  talks: z.array(PublicTalk),
});
export type PublicProgram = z.infer<typeof PublicProgram>;

export interface LoadedProgram {
  readonly program: PublicProgram;
  readonly path: string;
  readonly isFixture: boolean;
}

/** Real snapshot first, fixture second; undefined when neither exists (the page then says so). */
export const loadProgram = (realPath: string, fixturePath: string): LoadedProgram | undefined => {
  const path = existsSync(realPath) ? realPath : existsSync(fixturePath) ? fixturePath : undefined;
  if (!path) return undefined;
  const parsed = PublicProgram.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`programme file ${path} invalid: ${parsed.error.message}`);
  return { program: parsed.data, path, isFixture: parsed.data.fixture || path === fixturePath };
};

export const talkIdsBySlot = (program: PublicProgram): ReadonlyMap<string, ReadonlySet<string>> =>
  new Map(
    program.slots.map((slot) => [
      slot,
      new Set(program.talks.filter((t) => t.slot === slot).map((t) => t.id)),
    ]),
  );
