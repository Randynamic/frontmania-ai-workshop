import type { Talk } from '../schemas/talk.js';

/**
 * Renders a registry prompt template. `{{name}}` placeholders only; the
 * serialisers below are the contract with the Python twin in optimize/:
 * both sides must produce byte-identical strings for the same input, which
 * optimize/contract_test.py checks against `pnpm rank-once`.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export const promptVariables = (template: string): readonly string[] => [
  ...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string)),
];

export const renderPrompt = (template: string, vars: Readonly<Record<string, string>>): string => {
  const missing = promptVariables(template).filter((name) => vars[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `renderPrompt: missing variable${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`,
    );
  }
  return template.replace(PLACEHOLDER, (_match, name: string) => vars[name] as string);
};

/** Canonical profile string: compact JSON, key order as given. Python: json.dumps(profile, separators=(',', ':'), ensure_ascii=False). */
export const serializeProfile = (profile: unknown): string => JSON.stringify(profile);

/** One line per talk, in programme order. */
export const serializeTalk = (talk: Talk): string =>
  `- [${talk.id}] ${talk.title} — ${talk.speakers.join(', ')} (${talk.room}, ${talk.durationMin} min): ${talk.abstract}`;

export const serializeTalks = (talks: readonly Talk[]): string =>
  talks.map(serializeTalk).join('\n');
