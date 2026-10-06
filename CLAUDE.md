# talk-picker: guidance for AI assistants

This is a 105-minute workshop repository (Frontmania 2026). Participants build
a talk-picking agent with Mastra, traced to a self-hosted MLflow, in three
exercises on checkpoint branches. Check which branch you are on first:
`git branch --show-current`.

## The contract

- An exercise is defined by the `// TODO(exercise NN, step S)` markers in the
  code and the numbered steps in `README.md`. Same numbers in both.
- `pnpm check:NN` is the only definition of done. Run
  `pnpm check:NN --static` (offline, mock model) and `pnpm test` before saying
  an exercise is done. The live layer of the check needs the room's backend.
- Do not edit `scripts/check/*`, `src/observability/mask.ts`, `data/`,
  `infra/` or `.github/` during an exercise. They are the harness, not the task.
- Stuck for 8 minutes? `pnpm run switch NN-done` and keep going. Nobody checks.
  The script stashes local changes (`git stash --include-untracked`) and then runs
  `git checkout NN-done`; a bare `git checkout` fails over edited exercise files.
  Use `pnpm run switch <branch>` for every branch change, also between blocks.

## Branches

`00-setup` (foundation: `src/mastra/index.ts` with masked tracing, data, infra,
shared schemas; no agents, workflows or exercise code), `01-start`/`01-done`
(Profile schema, profile agent, `pnpm run profile`, `pnpm check:01`), `02-start`/`02-done`,
`03-start`/`03-done`, `final` (adds the trainer-only `optimize/`). Every branch
installs, typechecks, lints and passes `pnpm test`.

## Verify APIs, never guess

The pinned versions are in `package.json` and `pnpm-lock.yaml`. Do not upgrade
anything. Before suggesting a Mastra, AI SDK or Zod call, read the installed
declaration: `node_modules/@mastra/core/dist/**/*.d.ts`,
`node_modules/@mastra/libsql/dist/**/*.d.ts`, `node_modules/ai/dist/index.d.ts`.
Mastra releases daily; names on the internet may not match the installed 1.71.0.

## Privacy rules

- Never log, print or persist the CV text. Scripts register it with
  `registerRawText()` and pass it to the model only.
- Never add identity fields (name, email, phone, employer) to `Profile`; the
  backend rejects them.
- A participant's own CV lives in `private/` (git-ignored). Do not open, read,
  quote or commit anything under `private/`; pass its path to
  `pnpm run profile --cv` and nothing else.
- `src/observability/mask.ts` is the one place in this repo that mutates an
  object in place: Mastra's `SpanOutputProcessor` contract requires the same
  span instance back. Keep it that way; everything else is immutable.

## Toolchain

Node 22 (`.nvmrc`), pnpm 12.6.0 via corepack. `pnpm run doctor` checks the
environment and `pnpm run profile` extracts a profile; plain `pnpm doctor` and
`pnpm profile` are pnpm built-ins, not these scripts (always say `pnpm run`).
`MODEL_MODE=mock` runs everything offline; CI and `--static` checks use it.

## Style

TypeScript strict, no `any`, small files, Zod at every boundary, immutable data
(except `mask.ts`), explicit error handling with messages a participant can act on.
