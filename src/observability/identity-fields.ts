import { isCommonTerm, NAME_PARTICLES } from './common-terms.js';

/**
 * Identity values that the capitalised-word rules in identity-hints.ts cannot
 * see, read from the raw text whatever its letter case or layout:
 *
 * - the value after a `Name:` / `Naam:` label ("Name: pieter van den berg"
 *   in a PDF export whose first lines are a page header, not the name),
 * - links and handles ("github.com/pvdb", "@pvdb") and their last segment,
 * - Dutch postcodes ("1015 CX", also written "1015CX"),
 * - the word after "at" or "bij" in any case ("frontend dev at coolblue").
 *
 * Every value becomes an identity hint, so the trace masker and the echo
 * scrub replace it case-insensitively on word boundaries. A false positive
 * over-masks one word; it never lets a value through.
 */

const MIN_FIELD_LENGTH = 3;
const EMAIL = /\S+@\S+\.\S+/g;
const NAME_LABEL = /^\s*(?:full\s+name|volledige\s+naam|name|naam)\s*[:：]\s*(.+?)\s*$/gimu;
const WORD = /[\p{L}\p{N}]+(?:[.'’&-][\p{L}\p{N}]+)*/gu;
const LINK =
  /(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+(?:com|org|nl|io|dev|net|be|de|eu|co|ai|app|me)(?:\/[^\s,;()<>"']*)?)/gi;
const HANDLE = /(?<![\p{L}\p{N}_.])@([A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)/gu;
/** Dutch postcode: four digits (no leading zero), optional space, two capitals except SA, SD, SS. */
const POSTCODE = /(?<![\p{L}\p{N}])([1-9]\d{3}) ?(?!SA|SD|SS)([A-Z]{2})(?![\p{L}\p{N}])/gu;
const AFTER_EMPLOYER_WORD =
  /(?<![\p{L}\p{N}])(?:at|bij)\s+([\p{L}\p{N}]+(?:[.'’&-][\p{L}\p{N}]+)*)/giu;
/** "good at scaling", "at least": verbs and a few fixed phrases are not employers. */
const VERB_ENDING = /(?:ed|ing)$/i;
const NOT_EMPLOYERS: ReadonlySet<string> = new Set([
  'least',
  'scale',
  'home',
  'night',
  'once',
  'times',
  'heart',
  'ease',
  'best',
  'first',
  'hand',
  'large',
]);
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

const isNamePart = (word: string): boolean =>
  word.length >= MIN_FIELD_LENGTH && !NAME_PARTICLES.has(word.toLowerCase()) && !isCommonTerm(word);

const labelledNames = (text: string): readonly string[] =>
  [...text.matchAll(NAME_LABEL)].flatMap((match) => {
    const value = match[1] ?? '';
    const parts = [...value.matchAll(WORD)].map((word) => word[0]).filter(isNamePart);
    return parts.length > 0 ? [value, ...parts] : [];
  });

const lastSegment = (path: string): string | undefined =>
  path
    .split('/')
    .filter((segment) => segment.length > 0)
    .at(-1);

const links = (text: string): readonly string[] =>
  [...text.replace(EMAIL, ' ').matchAll(LINK)].flatMap((match) => {
    const link = (match[1] ?? '').replace(TRAILING_PUNCTUATION, '').replace(/\/+$/, '');
    const [, ...pathParts] = link.split('/');
    const segment = pathParts.length > 0 ? lastSegment(pathParts.join('/')) : undefined;
    const handle = segment !== undefined && isNamePart(segment) ? [segment] : [];
    return [link, ...handle];
  });

const handles = (text: string): readonly string[] =>
  [...text.replace(EMAIL, ' ').matchAll(HANDLE)]
    .map((match) => match[1] ?? '')
    .filter((handle) => handle.length >= MIN_FIELD_LENGTH)
    .flatMap((handle) => [`@${handle}`, handle]);

const postcodes = (text: string): readonly string[] =>
  [...text.matchAll(POSTCODE)].flatMap((match) => [
    `${match[1]} ${match[2]}`,
    `${match[1]}${match[2]}`,
  ]);

const employersAfterPreposition = (text: string): readonly string[] =>
  [...text.replace(EMAIL, ' ').matchAll(AFTER_EMPLOYER_WORD)]
    .map((match) => match[1] ?? '')
    .filter(
      (word) =>
        isNamePart(word) && !VERB_ENDING.test(word) && !NOT_EMPLOYERS.has(word.toLowerCase()),
    );

/** Every labelled name, link, handle, postcode and employer-after-preposition in a text. */
export const identityFields = (text: string): readonly string[] => [
  ...labelledNames(text),
  ...links(text),
  ...handles(text),
  ...postcodes(text),
  ...employersAfterPreposition(text),
];
