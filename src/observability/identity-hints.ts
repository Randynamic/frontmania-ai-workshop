import { isCommonTerm, NAME_PARTICLES } from './common-terms.js';
import { identityFields } from './identity-fields.js';

/**
 * Values that identify the author of a registered text even when a model
 * echoes them on their own, outside any full line: names, employers, places.
 *
 * Line-based masking (mask.ts) catches every line of 20+ characters and the
 * three header lines. A span output such as
 * `{"role":"Senior Frontend Engineer at Coolblue"}` contains no such line, so
 * these hints close that gap. They are read from the raw text itself, not from
 * any markup, so a CV pasted as plain text ("CURRICULUM VITAE", "Senior
 * Frontend Engineer - Bol.com", "at Coolblue") yields them as well as the
 * markdown persona CVs do:
 *
 * - every capitalised word of the first three lines (where the name is),
 * - every other capitalised word that is not a heading, job title,
 *   technology or common word (common-terms.ts) and that the text never
 *   writes in lowercase ("Design" next to "design systems" is a word, not a
 *   name),
 * - the phrases those words form ("Jan de Vries", "Kanaalwerk Digital").
 *
 * - labelled names, links, handles, postcodes and the word after "at" or
 *   "bij", in any letter case (identity-fields.ts).
 *
 * The common-terms list keeps words like "React" readable in every trace and
 * profile; a word missing from it is over-masked, never leaked.
 */

/** Shorter tokens are initials or noise; three keeps names such as "Jan" or "Kim". */
const MIN_HINT_LENGTH = 3;
/** The first lines of a text carry the name and contact block. */
const HEADER_LINES = 3;
/** A single-line registration (typed skills) has no name header. */
const MIN_LINES_FOR_HEADER = 2;
/** A word with inner dots, hyphens, apostrophes or ampersands stays one token: Bol.com, AT&T. */
const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:[.'’&-][\p{L}\p{N}]+)*/gu;
const CAPITALISED = /^\p{Lu}/u;
const HAS_LETTER = /\p{L}/u;
/** The persona CVs open with `<!-- fictional ... -->`; that line is not the name. */
const HTML_COMMENT_LINE = /^<!--.*-->$/;
/** Addresses and links are masked by their own patterns and must not count as lowercase words. */
const EMAIL_OR_URL =
  /\S+@\S+|\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|org|nl|io|dev|net)\/\S*/gi;
/** A sentence or bullet starts after one of these (or at the start of the line). */
const SENTENCE_BREAK = /[.!?:;|•*#>(–—-]$/;
/** "Architected", "Leading": a verb that opens a bullet is not a name. */
const VERB_ENDING = /(?:ed|ing)$/i;
const SPACES_ONLY = /^[ \t]+$/;

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const nonEmptyLines = (text: string): readonly string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(EMAIL_OR_URL, ' ').trim())
    .filter((line) => line.length > 0 && !HTML_COMMENT_LINE.test(line));

const tokensOf = (line: string): readonly Token[] =>
  [...line.matchAll(TOKEN_PATTERN)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));

const isCapitalised = (token: Token): boolean => CAPITALISED.test(token.text);

/** Every word the text writes in lowercase somewhere: those are words, not names. */
const lowercaseWords = (lines: readonly string[]): ReadonlySet<string> =>
  new Set(
    lines
      .flatMap(tokensOf)
      .map((token) => token.text)
      .filter((word) => HAS_LETTER.test(word) && word === word.toLowerCase()),
  );

const opensSentence = (line: string, token: Token): boolean => {
  const before = line.slice(0, token.start).trimEnd();
  return before.length === 0 || SENTENCE_BREAK.test(before);
};

interface HintContext {
  readonly lowercase: ReadonlySet<string>;
  readonly isHeader: boolean;
}

const HYPHEN = /-/;

/**
 * A known word, or a compound whose parts are all known, written in
 * lowercase or too short to be a name ("AI-generated", "Co-organiser").
 */
const isOrdinaryWord = (word: string, lowercase: ReadonlySet<string>): boolean => {
  const isKnown = (part: string): boolean =>
    isCommonTerm(part) || lowercase.has(part.toLowerCase());
  const isOrdinaryPart = (part: string): boolean =>
    isKnown(part) || part === part.toLowerCase() || part.length < MIN_HINT_LENGTH;
  return isKnown(word) || (HYPHEN.test(word) && word.split(HYPHEN).every(isOrdinaryPart));
};

/** One capitalised word that may be a name, an employer or a place. */
const isHintWord = (line: string, token: Token, context: HintContext): boolean => {
  if (!isCapitalised(token) || token.text.length < MIN_HINT_LENGTH) return false;
  if (isCommonTerm(token.text)) return false;
  if (context.isHeader) return true;
  if (isOrdinaryWord(token.text, context.lowercase)) return false;
  return !(opensSentence(line, token) && VERB_ENDING.test(token.text));
};

const DOMAIN_SUFFIX = /\.(?:com|nl|be|de|io|dev|net|org|eu|co|ai|app)$/i;

/**
 * "Oosterhuis-Bakker" is caught whole and as "Oosterhuis" and "Bakker";
 * "Winkelwagen.nl" also as "Winkelwagen". Particles and common words are not parts.
 */
const nameParts = (word: string): readonly string[] => {
  const withoutDomain = word.replace(DOMAIN_SUFFIX, '');
  const parts = [
    ...(withoutDomain === word ? [] : [withoutDomain]),
    ...(HYPHEN.test(word) ? withoutDomain.split(HYPHEN) : []),
  ];
  return parts.filter(
    (part) => part.length >= MIN_HINT_LENGTH && CAPITALISED.test(part) && !isCommonTerm(part),
  );
};

/** Tokens separated by nothing but spaces: "Jan de Vries", not "Engineer - Bol.com". */
const spaceRuns = (line: string, tokens: readonly Token[]): readonly (readonly Token[])[] =>
  tokens.reduce<readonly (readonly Token[])[]>((runs, token) => {
    const current = runs.at(-1);
    const previous = current?.at(-1);
    const isJoined =
      previous !== undefined && SPACES_ONLY.test(line.slice(previous.end, token.start));
    return isJoined && current ? [...runs.slice(0, -1), [...current, token]] : [...runs, [token]];
  }, []);

/** Capitalised stretches of a run; a particle belongs to one only between two capitalised words. */
const nameSegments = (run: readonly Token[]): readonly (readonly Token[])[] =>
  run.reduce<readonly (readonly Token[])[]>(
    (segments, token, index) => {
      const next = run[index + 1];
      const isParticle =
        NAME_PARTICLES.has(token.text.toLowerCase()) && next !== undefined && isCapitalised(next);
      const current = segments.at(-1) ?? [];
      if (isCapitalised(token) || (isParticle && current.length > 0)) {
        return [...segments.slice(0, -1), [...current, token]];
      }
      return current.length > 0 ? [...segments, []] : segments;
    },
    [[]],
  );

/** The phrase from the first hint word to the end of its segment ("Kanaalwerk Digital"). */
const phrasesOf = (
  line: string,
  tokens: readonly Token[],
  isHint: (token: Token) => boolean,
): readonly string[] =>
  spaceRuns(line, tokens)
    .flatMap(nameSegments)
    .map((segment) => segment.slice(Math.max(0, segment.findIndex(isHint))))
    .filter((segment) => segment.length >= 2 && segment.some(isHint))
    .map((segment) => line.slice(segment[0]!.start, segment.at(-1)!.end));

const hintsOfLine = (line: string, context: HintContext): readonly string[] => {
  const tokens = tokensOf(line);
  const isHint = (token: Token): boolean => isHintWord(line, token, context);
  const words = tokens.filter(isHint).map((token) => token.text);
  return [...words, ...words.flatMap(nameParts), ...phrasesOf(line, tokens, isHint)];
};

/** Every identity hint for one registered text, deduplicated. */
export const identityHints = (text: string): readonly string[] => {
  const lines = nonEmptyLines(text);
  const lowercase = lowercaseWords(lines);
  const headerCount = lines.length >= MIN_LINES_FOR_HEADER ? HEADER_LINES : 0;
  return [
    ...new Set([
      ...lines.flatMap((line, index) =>
        hintsOfLine(line, { lowercase, isHeader: index < headerCount }),
      ),
      ...identityFields(text),
    ]),
  ];
};

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const escapeRegExp = (value: string): string => value.replace(REGEX_SPECIALS, '\\$&');

/**
 * A hint as a case-insensitive, word-bounded pattern: a model that writes
 * "kanaalwerk digital" or "FEMKE" is caught too, "Femkes" is not.
 */
export const identityHintPattern = (hint: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(hint)}(?![\\p{L}\\p{N}])`, 'giu');

/** Every hint of one registered text as a pattern, longest first. */
export const identityHintPatterns = (text: string): readonly RegExp[] =>
  [...identityHints(text)].sort((a, b) => b.length - a.length).map(identityHintPattern);
