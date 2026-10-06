import type { AnySpan, SpanOutputProcessor } from '@mastra/core/observability';
import { identityHintPatterns, identityHints } from './identity-hints.js';
import { registeredTexts, type RawTextHandle } from './raw-text-registry.js';

/**
 * CvMaskingProcessor: value-based masking of participant text in traces.
 *
 * Mastra's SensitiveDataFilter redacts by field name (password, token, ...).
 * A CV pasted into a prompt has no such field name, so this processor masks
 * by value: every text registered with registerRawText() is replaced by its
 * hash marker wherever it appears in a span, whole or line by line, raw or
 * JSON-escaped. Emails and phone numbers are masked in every string as well,
 * and so are the bare name tokens and employers (identity-hints.ts) that a
 * model output may echo outside any full CV line, in any letter case.
 *
 * This is the trace-side layer. The output-side layers are the Profile
 * schema (no identity fields, exercise 1) and the backend identity guard.
 *
 * Contract exception: SpanOutputProcessor.process must mutate the span it
 * receives and return the same instance (see the interface comment in
 * @mastra/core/dist/observability/types/tracing.d.ts). This is the one place
 * in the repo that assigns to an existing object. The nested values are
 * still built immutably; only the span's own fields are reassigned.
 */

/** Lines shorter than this are too generic to mask on their own. */
export const MIN_LINE_LENGTH = 20;
/** The first lines of a CV carry the name and contact block; always masked. */
const HEADER_LINES = 3;
const MIN_HEADER_LINE_LENGTH = 3;

export const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export const PHONE_PATTERN = /(?<!\w)\+?\d[\d ().-]{7,}\d(?!\w)/g;
export const EMAIL_MARKER = '[email]';
export const PHONE_MARKER = '[phone]';

const MASKED_SPAN_FIELDS = [
  'input',
  'output',
  'attributes',
  'metadata',
  'errorInfo',
  'requestContext',
] as const;

interface Secret {
  readonly value: string;
  readonly marker: string;
}

/** An identity hint matched case-insensitively on word boundaries (identity-hints.ts). */
export interface HintSecret {
  readonly pattern: RegExp;
  readonly marker: string;
}

const jsonEscaped = (value: string): string => JSON.stringify(value).slice(1, -1);

const nonEmptyLines = (text: string): readonly string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Every substring that must disappear for one registered text, longest first:
 * the whole text, its header lines, every line of 20+ characters, and the
 * identity hints (names, employers, places) that a model may echo alone.
 */
export const secretsFor = (text: string, handle: RawTextHandle): readonly Secret[] => {
  const lines = nonEmptyLines(text);
  const header = lines.slice(0, HEADER_LINES).filter((l) => l.length >= MIN_HEADER_LINE_LENGTH);
  const longLines = lines.filter((line) => line.length >= MIN_LINE_LENGTH);
  const values = [...new Set([text, ...header, ...longLines, ...identityHints(text)])];
  const withEscaped = values.flatMap((value) => [value, jsonEscaped(value)]);
  return [...new Set(withEscaped)]
    .sort((a, b) => b.length - a.length)
    .map((value) => ({ value, marker: handle.marker }));
};

/** The identity hints of one registered text in any letter case, longest first. */
export const hintSecretsFor = (text: string, marker: string): readonly HintSecret[] =>
  identityHintPatterns(text).map((pattern) => ({ pattern, marker }));

/**
 * Exact secrets first (whole lines, so a contact line goes as one piece),
 * then emails and phones, then the case-insensitive identity hints.
 */
const maskString = (
  value: string,
  secrets: readonly Secret[],
  hints: readonly HintSecret[],
): string => {
  const afterSecrets = secrets.reduce(
    (acc, secret) =>
      acc.includes(secret.value) ? acc.replaceAll(secret.value, secret.marker) : acc,
    value,
  );
  const afterContacts = afterSecrets
    .replace(EMAIL_PATTERN, EMAIL_MARKER)
    .replace(PHONE_PATTERN, PHONE_MARKER);
  return hints.reduce((acc, hint) => acc.replace(hint.pattern, hint.marker), afterContacts);
};

/** Pure deep walk: returns a masked copy, never touches the input. */
export const maskValue = (
  value: unknown,
  secrets: readonly Secret[],
  hints: readonly HintSecret[] = [],
): unknown => {
  if (typeof value === 'string') return maskString(value, secrets, hints);
  if (Array.isArray(value)) return value.map((item) => maskValue(item, secrets, hints));
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      maskValue(item, secrets, hints),
    ]),
  );
};

export const currentSecrets = (): readonly Secret[] =>
  registeredTexts().flatMap(({ text, handle }) => secretsFor(text, handle));

export const currentHintSecrets = (): readonly HintSecret[] =>
  registeredTexts().flatMap(({ text, handle }) => hintSecretsFor(text, handle.marker));

export class CvMaskingProcessor implements SpanOutputProcessor {
  readonly name = 'cv-masking';

  process(span?: AnySpan): AnySpan | undefined {
    if (!span) return undefined;
    const secrets = currentSecrets();
    const hints = currentHintSecrets();
    const target = span as unknown as Record<string, unknown>;
    for (const field of MASKED_SPAN_FIELDS) {
      if (target[field] !== undefined) {
        // Contract: mutate the live span instance (see the class comment).
        target[field] = maskValue(target[field], secrets, hints);
      }
    }
    return span;
  }

  async shutdown(): Promise<void> {
    // Nothing to flush: the processor holds no state of its own.
  }
}
