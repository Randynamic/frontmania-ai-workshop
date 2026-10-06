import { readFileSync, writeFileSync } from 'node:fs';
import { ArchiveFile, ProgramFile } from '../../src/schemas/talk.js';
import {
  abstractStats,
  buildArchive,
  buildProgram,
  programStats,
  SESSIONIZE_EVENTS,
  sessionizeUrl,
  talkId,
} from './build.js';
import { parseSessions } from './parse.js';

/**
 * pnpm snapshot [--program-html <file>] [--archive-html <file>] [--out <dir>]
 *
 * Refetches both Sessionize embeds (or reads saved HTML), rebuilds
 * data/program-2026.json, data/archive/2025.json and data/stats.json, and
 * prints the measured numbers. Run it again on 6 October and diff the files.
 * Exit 1 on any fetch, parse or schema failure.
 */

const FETCH_TIMEOUT_MS = 30_000;
const JSON_INDENT = 2;

interface Args {
  readonly programHtml: string | undefined;
  readonly archiveHtml: string | undefined;
  readonly out: string;
}

const parseArgs = (argv: readonly string[]): Args => {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    programHtml: value('--program-html'),
    archiveHtml: value('--archive-html'),
    out: value('--out') ?? 'data',
  };
};

const fetchHtml = async (url: string): Promise<string> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
};

const loadHtml = async (file: string | undefined, url: string): Promise<string> =>
  file ? readFileSync(file, 'utf8') : fetchHtml(url);

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, JSON_INDENT)}\n`, 'utf8');
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const snapshotAt = new Date().toISOString();
  const { program, archive } = SESSIONIZE_EVENTS;

  const programSessions = parseSessions(
    await loadHtml(args.programHtml, sessionizeUrl(program.id)),
  );
  const built = buildProgram(programSessions, {
    year: program.year,
    event: program.event,
    source: sessionizeUrl(program.id),
    snapshotAt,
  });
  const programFile = ProgramFile.parse(built.file);

  const archiveSessions = parseSessions(
    await loadHtml(args.archiveHtml, sessionizeUrl(archive.id)),
  );
  const archiveFile = ArchiveFile.parse(
    buildArchive(archiveSessions, {
      year: archive.year,
      event: archive.event,
      source: sessionizeUrl(archive.id),
      snapshotAt,
    }),
  );

  const stats = {
    snapshotAt,
    program: {
      ...programStats(built),
      // Ids and start times only: titles of excluded sessions are not workshop data.
      excludedSessions: built.excluded.map((s) => ({
        id: talkId(program.year, s.sessionId),
        startTime: s.startTime,
      })),
      allSessions: abstractStats(programSessions.map((s) => s.abstract)),
    },
    archive: { year: archive.year, ...abstractStats(archiveFile.talks.map((t) => t.abstract)) },
  };

  writeJson(`${args.out}/program-2026.json`, programFile);
  writeJson(`${args.out}/archive/2025.json`, archiveFile);
  writeJson(`${args.out}/stats.json`, stats);
  console.log(JSON.stringify(stats, null, JSON_INDENT));
};

main().catch((error: unknown) => {
  console.error(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
