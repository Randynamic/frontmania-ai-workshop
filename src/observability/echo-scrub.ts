import {
  EMAIL_MARKER,
  EMAIL_PATTERN,
  hintSecretsFor,
  type HintSecret,
  PHONE_MARKER,
  PHONE_PATTERN,
} from './mask.js';

/**
 * Output-side twin of the trace masker: removes identity values a model
 * echoed inside a structured answer (a profile) before that answer is saved,
 * posted or rendered into a later prompt.
 *
 * mask.ts masks spans of the process that registered the CV. A profile
 * written to `.talk-picker/profile.json` travels further: to the backend, the
 * GEPA dataset and the ranker and planner prompts of later `pnpm plan` and
 * `pnpm ask` processes, where no raw text is registered and the masker has
 * nothing to match. So every string value is scrubbed here, once, at the
 * source: the names, employers and places read from the raw text (identity-hints.ts)
 * are replaced by the text's hash marker, case-insensitively and on word
 * boundaries; emails and phone numbers by `[email]` and `[phone]`.
 *
 * Pure: returns a new value and the number of replacements, never mutates.
 */

export interface EchoScrubResult<T> {
  readonly value: T;
  readonly replaced: number;
}

/** Emails and phones first, so an address such as `femke.oosterhuis@…` is masked whole. */
const replacementsFor = (rawText: string, marker: string): readonly HintSecret[] => [
  { pattern: EMAIL_PATTERN, marker: EMAIL_MARKER },
  { pattern: PHONE_PATTERN, marker: PHONE_MARKER },
  ...hintSecretsFor(rawText, marker),
];

/**
 * "femke oosterhuis" becomes one marker, not two: repeated markers separated
 * only by spaces or punctuation collapse, so a scrubbed value stays within
 * the Profile length bounds.
 */
const REPEATED_MARKER = /(\[[^\]\s]+\])(?:[\s,.;-]*\1)+/g;

const scrubString = (
  text: string,
  replacements: readonly HintSecret[],
): EchoScrubResult<string> => {
  const scrubbed = replacements.reduce<EchoScrubResult<string>>(
    (acc, { pattern, marker }) => {
      const count = acc.value.match(pattern)?.length ?? 0;
      return count === 0
        ? acc
        : { value: acc.value.replace(pattern, marker), replaced: acc.replaced + count };
    },
    { value: text, replaced: 0 },
  );
  return scrubbed.replaced === 0
    ? scrubbed
    : { ...scrubbed, value: scrubbed.value.replace(REPEATED_MARKER, '$1') };
};

const scrubEntries = (
  entries: readonly (readonly [string, unknown])[],
  replacements: readonly HintSecret[],
): EchoScrubResult<readonly (readonly [string, unknown])[]> =>
  entries.reduce<EchoScrubResult<readonly (readonly [string, unknown])[]>>(
    (acc, [key, item]) => {
      const scrubbed = scrubUnknown(item, replacements);
      return {
        value: [...acc.value, [key, scrubbed.value] as const],
        replaced: acc.replaced + scrubbed.replaced,
      };
    },
    { value: [], replaced: 0 },
  );

const scrubUnknown = (
  value: unknown,
  replacements: readonly HintSecret[],
): EchoScrubResult<unknown> => {
  if (typeof value === 'string') return scrubString(value, replacements);
  if (Array.isArray(value)) {
    const scrubbed = scrubEntries(
      value.map((item, index) => [String(index), item] as const),
      replacements,
    );
    return { value: scrubbed.value.map(([, item]) => item), replaced: scrubbed.replaced };
  }
  if (value === null || typeof value !== 'object') return { value, replaced: 0 };
  const scrubbed = scrubEntries(Object.entries(value), replacements);
  return { value: Object.fromEntries(scrubbed.value), replaced: scrubbed.replaced };
};

/** Scrubs every string in `value` against the identity hints of `rawText`. */
export const scrubEchoedIdentity = <T>(
  value: T,
  rawText: string,
  marker: string,
): EchoScrubResult<T> => {
  const scrubbed = scrubUnknown(value, replacementsFor(rawText, marker));
  // The walk keeps every key and array position; only string contents change.
  return { value: scrubbed.value as T, replaced: scrubbed.replaced };
};
