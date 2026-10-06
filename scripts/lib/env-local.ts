/**
 * Optional `.env.local` on top of `.env` (repo-plan 4.1, page variant: the
 * blind-pick page issues the id and the participant puts `TALK_PICKER_ID`
 * here; the slip variant never creates the file).
 *
 * Why not `node --env-file-if-exists=.env.local`: Node 22.23 and 24.18 print
 * `.env.local not found. Continuing without it.` for a missing optional file,
 * which contradicts "every doctor line says OK" on the slip variant. This
 * loader is silent when the file is absent.
 *
 * `process.loadEnvFile` (Node >= 20.12, verified in @types/node 22.20.4
 * process.d.ts) never overwrites a variable that is already set, so the shell
 * and `.env` win over `.env.local`. Only `TALK_PICKER_ID` is documented for
 * `.env.local`, which `.env` does not carry.
 */
export const ENV_LOCAL_FILE = '.env.local';

export interface EnvLocalDeps {
  readonly path: string;
  readonly fileExists: (path: string) => boolean;
  readonly loadEnvFile: (path: string) => void;
}

export interface EnvLocalResult {
  readonly loaded: boolean;
  readonly path: string;
}

export const loadEnvLocal = (deps: EnvLocalDeps): EnvLocalResult => {
  if (!deps.fileExists(deps.path)) return { loaded: false, path: deps.path };
  try {
    deps.loadEnvFile(deps.path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${deps.path} exists but could not be loaded: ${reason}`, { cause: error });
  }
  return { loaded: true, path: deps.path };
};
