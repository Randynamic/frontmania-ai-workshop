# Data

Everything the talk picker reads from disk. Every file here is validated by
`src/data/data-files.test.ts` (`pnpm test`); the numbers below are measured
from the committed files, not copied from the outline.

## Files and provenance

| File                               | What                                                                                                                        | Source                                                                                                                                          | Fixture?                    | Permission status                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `program-2026.json`                | The 16 rankable Frontmania 2026 talks (slots 14:15, 15:30, 16:30)                                                           | Sessionize public embed `gx2dpiu7`, `https://sessionize.com/api/v2/gx2dpiu7/view/Sessions?under=true`, parsed by `pnpm snapshot` on 26 Sep 2026 | No (`"fixture": false`)     | Public programme; speaker names and speaker-authored abstracts. Organiser consent for a public repo is **pending** (outline task: ask the organisation).        |
| `archive/2025.json`                | All 30 Frontmania 2025 sessions for the vector store                                                                        | Sessionize public embed `ary2w1mc`, same path, same run                                                                                         | No                          | Same as above.                                                                                                                                                  |
| `archive/2022.json` to `2024.json` | Earlier editions                                                                                                            | Organiser exports                                                                                                                               | Absent                      | Not delivered yet; the archive is 2025 only until they arrive. Drop the files in this directory and run `pnpm ingest`.                                          |
| `archive.db`                       | LibSQL vector index `archive`, one row per archive abstract, metadata `{ id, year, title, speakers, room, videoUrl, text }` | Built by `pnpm ingest` from `archive/*.json`                                                                                                    | Derived                     | Same as the source files.                                                                                                                                       |
| `archive-manifest.json`            | Which embedding built `archive.db` (`mode`, `embedding`, `dimension`, `rows`, `years`, `builtAt`)                           | `pnpm ingest`                                                                                                                                   | Derived                     | Not personal.                                                                                                                                                   |
| `stats.json`                       | Measured numbers of the snapshot (see below)                                                                                | `pnpm snapshot`                                                                                                                                 | Derived                     | Not personal.                                                                                                                                                   |
| `fixtures/program-2026.json`       | 16 fictional talks, same schema and slot distribution as the snapshot                                                       | Written by hand                                                                                                                                 | **Yes** (`"fixture": true`) | Fictional; safe to publish.                                                                                                                                     |
| `fixtures/archive-2025.json`       | 30 fictional 2025 talks, same schema                                                                                        | Written by hand                                                                                                                                 | **Yes**                     | Fictional; safe to publish.                                                                                                                                     |
| `cvs/0N-*.md` (5)                  | Persona CVs, English, 350 to 600 words                                                                                      | Written by hand                                                                                                                                 | Fictional                   | No real person, employer, address, email (`example.org`) or phone (`+31 6 0000 000N` placeholders). Each file starts with an HTML comment saying so.            |
| `cvs/profiles/<persona>.json`      | The profile the exercise-1 agent should extract per persona                                                                 | Written by hand from the CV on 26 Sep 2026                                                                                                      | Fictional                   | Schema has no identity fields. Regenerate with `01-done` (`pnpm run profile --cv data/cvs/<file>`) and review before 7 Oct if the trainer prefers model output. |
| `cvs/labels.json`                  | Expected pick per persona per slot: `picks` (snapshot ids) and `fixturePicks` (fixture ids)                                 | Provisional, written by the data engineer from the abstracts                                                                                    | Not personal                | **Trainer reviews and confirms before 7 Oct** (outline task 8). Two personas (01, 03) share two picks; that is intended, both are accessibility-minded.         |

Speaker names and abstracts in the snapshot and the archive are the speakers'
own words, published on the public Frontmania programme. They are in the repo
so the workshop runs on real data. The fixtures exist so the repo also runs
without them.

## Measured numbers (26 Sep 2026 snapshot; `stats.json` is the source)

Slides and the facilitator guide quote these, not the outline's estimates.

| Measure                           | Value                                                                                                                                                                                                                                                                                                        | Outline said       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Sessions in the 2026 embed        | 29                                                                                                                                                                                                                                                                                                           | 28                 |
| Rankable talks (14:15 or later)   | 16                                                                                                                                                                                                                                                                                                           | 15                 |
| Talks per slot                    | 14:15: 6 (five at 14:15, of which one 20-minute, plus one at 14:40), 15:30: 6 (incl. the 105-minute workshop), 16:30: 4                                                                                                                                                                                      | 5 + 6 + 4          |
| Abstract words, rankable talks    | 2,029, median 123                                                                                                                                                                                                                                                                                            |                    |
| Abstract words, all 29 sessions   | 4,087, median 131                                                                                                                                                                                                                                                                                            | ~4,400, median 146 |
| Sessions in the 2025 embed        | 30                                                                                                                                                                                                                                                                                                           | 30                 |
| Abstract words 2025               | 3,149, median 100                                                                                                                                                                                                                                                                                            | ~3,700             |
| Excluded from `program-2026.json` | 13 sessions before 14:15: two morning talks (09:40, 10:05), the five 11:00 sessions including this workshop's own entry (Sessionize id 1187984, still listed under its old title on 26 Sep; the 6 Oct re-check confirms the new one), and the five 12:00 talks; `stats.json` lists them by id and start time |                    |

The 13:30 plenary panel the outline mentions is not in the Sessions embed at
all (it is a service slot in the grid), so nothing had to be excluded for it.

Slot bucketing: 14:15 to 15:29 -> `14:15`, 15:30 to 16:29 -> `15:30`, 16:30
and later -> `16:30`. The 14:40 Git Worktrees talk therefore sits in `14:15`
and the 15:30 to 17:15 workshop in `15:30`, as the outline decided.

Times come from the ISO UTC values in the embed's `data-sztz` attribute and
are rendered in Europe/Amsterdam, so the 12-hour format of the 2025 embed
never touches the data.

## Schemas

`src/schemas/talk.ts` defines `Talk`, `ProgramFile`, `ArchiveTalk`,
`ArchiveFile`; `src/data/archive.ts` defines `ArchiveManifest` and the row
metadata; `src/data/personas.ts` defines the persona profile and label
contracts. Fetched files and fixtures share the schema exactly; tests assert
identical top-level keys and talk keys.

Ids are frozen at snapshot time as `fm26-<sessionize session id>` and
`fm25-<sessionize session id>`; fixture ids are `fm26-fx-NN` and `fm25-fx-NN`.

## Rebuilding

```
pnpm snapshot                 # refetch both embeds, rewrite program-2026.json, archive/2025.json, stats.json
pnpm ingest                   # rebuild archive.db + archive-manifest.json through the proxy (needs PROXY_API_KEY)
MODEL_MODE=mock pnpm ingest   # same, offline, deterministic hash embedding (dimension 256)
pnpm ingest --fixture         # index the fixture archive instead
pnpm ingest --dry-run         # counts and a token estimate, touches nothing
```

`archive.db-shm` and `archive.db-wal` are SQLite side files that every open
recreates; they are git-ignored so `pnpm test` never dirties your checkout.

`pnpm snapshot` accepts `--program-html <file> --archive-html <file>` to
rebuild from saved HTML. Run it again on 6 October and diff the JSON files;
if the workshop's own Sessionize title changed, it is still excluded (it
starts at 11:00).

### The committed `archive.db` is a mock build

On 26 Sep 2026 the build machine had no proxy key, so `archive.db` was built
with `MODEL_MODE=mock` (`archive-manifest.json` says `"mode": "mock"`,
`"embedding": "mock-hash-v1"`, dimension 256). It is real lexical retrieval
over the real 2025 abstracts and it is what CI and `MODEL_MODE=mock` use.

**Status 26 Sep 2026: BLOCKED on a key.** The live build needs the proxy
on the VPS and a real key; neither exists yet (provisioning is out of scope
for this build). Until it is done, `pnpm run doctor` with `MODEL_MODE=live`
prints `FAIL data ... built in mock mode` on every branch, on purpose.

**By the 2 Oct rehearsal, at the latest D-1 (6 Oct), on the trainer laptop:**

```
# .env: MODEL_MODE=live and the reserve PROXY_API_KEY; any branch checked out, clean tree
pnpm ingest                                                     # manifest now says "mode": "live", "talk-picker-embed"
node --import tsx infra/scripts/publish-live-index.ts           # dry run: checks manifest, row count and dimension
node --import tsx infra/scripts/publish-live-index.ts --execute # one commit per branch on all 8, moves checkpoint/* tags
git push --all && git push --force --tags
pnpm run doctor                                                 # OK data ... (live index)
```

The script refuses a mock manifest, a manifest that disagrees with the
index, and an unflushed `archive.db-wal`. It commits the same two blobs on
top of each branch tip without checkout or rebase (the branches are
merge-derived; a rebase would flatten them), so `data/` stays identical on
all eight. In mock mode the embedding
model reads the manifest's dimension, so mock queries still fit a live-built
index.

## Publication decision (go/no-go, D-1 runbook step 11)

`program-2026.json`, `archive/2025.json`, `archive.db` and `stats.json` carry
real speaker names and speaker-authored abstracts. They are committed on every
branch so the workshop runs on real data, and the GitHub repo stays
**private** until the line below says otherwise. Codespaces works on a private
repo of the organisation; participants get access through the org invite or
the local zip from D-0. The trainer fills in the same line in the ops runbook
(`03-operations/infra-runbook.md`, D-1 step 11) and here, on every branch.

Deadline: **1 October 2026** (repo plan section 10, item 1). Without consent
by then, the 2 October rehearsal already runs on the fixture build below, so
there is exactly one verified path on 7 October.

| Date        | Decision                               | By     | Consequence                                                                                                                                                                                                |
| ----------- | -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 26 Sep 2026 | consent requested, not yet received    | Albert | repo private; nothing to do                                                                                                                                                                                |
| ______      | consent received / refused / no answer | ______ | received: repo may go public as it is; refused or no answer by 1 Oct: follow "Going public without consent" below (history rewrite of all eight branches) before any public push, or keep the repo private |

## Going public without consent: rewrite the history, not the tip

Deleting the files in a new commit is not enough: the real names and
abstracts stay in the history of all eight branches and every
`checkpoint/*` tag, and a public push publishes that history. Rewrite it once,
in a fresh clone, and publish only the rewritten clone to a **new** public
repository (flipping the existing private repository to public would still
expose the old commits by SHA).

1. Fresh clone of every branch and tag, then the rewrite
   ([git-filter-repo](https://github.com/newren/git-filter-repo), `brew install git-filter-repo`
   or `pip install git-filter-repo`):

   ```
   git clone --no-local <private repo url or path> talk-picker-public
   cd talk-picker-public
   for b in 00-setup 01-start 01-done 02-start 02-done 03-start 03-done final; do git branch --track "$b" "origin/$b" 2>/dev/null; done
   git filter-repo --force --invert-paths \
     --path data/program-2026.json --path data/archive/ \
     --path data/archive.db --path data/archive-manifest.json --path data/stats.json
   ```

   This rewrites all eight branches and moves every `checkpoint/*` tag onto
   the rewritten commits. It also drops `origin`, so nothing can be pushed to
   the private repository by accident.

2. Prove the files are gone from every commit (both commands print nothing):

   ```
   git rev-list --all --objects | grep -E 'data/(program-2026|stats)\.json|data/archive/|data/archive(\.db|-manifest\.json)'
   git log --all --oneline -- data/program-2026.json data/archive data/stats.json
   ```

3. On `00-setup`, rebuild the index from the fixture with a **real trainer
   key** (`PROXY_API_KEY` in `.env`, `MODEL_MODE=live`): `pnpm ingest --fixture`.
   A `MODEL_MODE=mock` build is not enough: `pnpm run doctor` fails its `data`
   line on a mock-built index in live mode. The manifest must say
   `"mode": "live"` and `"fixture": true`.
4. In the same commit, remove the `describe` blocks in
   `src/data/data-files.test.ts` that read the real files, and empty the
   `picks` values in `data/cvs/labels.json` (keep `fixturePicks`; the ids in
   the old history are Sessionize session ids only, no names or abstracts).
   The app falls back to the fixtures by itself (`src/data/program.ts`,
   `src/data/archive.ts`). Cherry-pick that commit onto the other seven
   branches (`data/` is the same on all of them).
5. Run the gates on all eight branches (install, typecheck, lint, format,
   test, `pnpm run check:NN --static` with the CI expectation per branch,
   `pnpm run doctor` with the trainer key: `OK data … (live index)`), move the
   `checkpoint/*` tags to the new heads, create the new public repository and
   push: `git push <public url> --all && git push <public url> --tags`.

If consent arrives after the rewrite, the real data is re-added on every
branch in a new commit and the index rebuilt with `pnpm ingest`.

Nothing in this directory is participant data. Blind picks, profiles from
the room, runs and feedback live only in the backend and MLflow, and are
deleted on 7 October at 18:00.
