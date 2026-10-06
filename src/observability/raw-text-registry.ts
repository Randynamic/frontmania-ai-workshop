import { createHash } from 'node:crypto';

/**
 * Registry of raw participant text (a CV, typed skills) that must never reach
 * a trace. Scripts register the text before calling a model; the
 * CvMaskingProcessor reads the registry and masks every registered value.
 *
 * The registry is process-local state by design: it is the one place where
 * the raw text lives, and it is never written to disk.
 */

export const HASH_PREFIX = 'cv:sha256:';
const HASH_LENGTH = 12;

export interface RawTextHandle {
  readonly hash: string;
  readonly marker: string;
}

interface RegistryEntry {
  readonly text: string;
  readonly handle: RawTextHandle;
}

let entries: readonly RegistryEntry[] = [];

export const hashText = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, HASH_LENGTH);

export const markerFor = (hash: string): string => `[${HASH_PREFIX}${hash}]`;

/** Registers raw text and returns the handle whose marker replaces it in traces. */
export const registerRawText = (text: string): RawTextHandle => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('registerRawText: refusing to register empty text');
  }
  const hash = hashText(trimmed);
  const existing = entries.find((entry) => entry.handle.hash === hash);
  if (existing) return existing.handle;
  const handle: RawTextHandle = { hash, marker: markerFor(hash) };
  entries = [...entries, { text: trimmed, handle }];
  return handle;
};

/** Snapshot of the registered texts, newest last. */
export const registeredTexts = (): readonly { text: string; handle: RawTextHandle }[] =>
  entries.map((entry) => ({ text: entry.text, handle: entry.handle }));

/** Test helper: forgets every registered text. */
export const clearRawTextRegistry = (): void => {
  entries = [];
};
