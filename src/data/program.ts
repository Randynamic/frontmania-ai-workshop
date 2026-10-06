import { ProgramFile, type Slot, type Talk } from '../schemas/talk.js';
import { readJsonFile } from './json-file.js';
import { DATA_PATHS, pickRealOrFixture } from './paths.js';

export interface LoadedProgram {
  readonly program: ProgramFile;
  readonly path: string;
  readonly isFixture: boolean;
}

/**
 * Loads data/program-2026.json, or the fixture when the real snapshot is
 * absent (public checkout without organiser consent). Logs which one once.
 */
export const loadProgram = (
  paths: { readonly real: string; readonly fixture: string } = {
    real: DATA_PATHS.program,
    fixture: DATA_PATHS.programFixture,
  },
  log: (line: string) => void = (line) => console.error(line),
): LoadedProgram => {
  const chosen = pickRealOrFixture(paths.real, paths.fixture);
  const program = readJsonFile(chosen.path, ProgramFile);
  const isFixture = chosen.isFixture || program.fixture;
  if (isFixture) log(`programme: using fixture ${chosen.path} (fictional talks)`);
  return { program, path: chosen.path, isFixture };
};

export const talksForSlot = (program: ProgramFile, slot: Slot): readonly Talk[] =>
  program.talks.filter((talk) => talk.slot === slot);

export const talkById = (program: ProgramFile, id: string): Talk | undefined =>
  program.talks.find((talk) => talk.id === id);
