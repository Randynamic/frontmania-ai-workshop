/** Pseudonymous participant ids: <animal>-<number>, e.g. otter-42. Stable, memorable, not personal. */
const ANIMALS = [
  'otter',
  'heron',
  'lynx',
  'finch',
  'badger',
  'marten',
  'plover',
  'stoat',
  'wren',
  'seal',
  'kite',
  'ibex',
  'hare',
  'raven',
  'newt',
  'moth',
  'crane',
  'vole',
  'tern',
  'pike',
] as const;
const MIN_NUMBER = 10;
const MAX_NUMBER = 99;
const NUMBER_SPAN = MAX_NUMBER - MIN_NUMBER + 1;
/** Every animal-number pair exactly once: 20 x 90 = 1800 ids. */
export const MAX_PSEUDONYMS = ANIMALS.length * NUMBER_SPAN;
/** Coprime with MAX_PSEUDONYMS so the walk visits every combination before repeating. */
const STEP = 1031;

export const pseudonymAt = (index: number, seed: number): string => {
  const combo = (index * STEP + seed) % MAX_PSEUDONYMS;
  const animal = ANIMALS[combo % ANIMALS.length] ?? ANIMALS[0];
  const number = MIN_NUMBER + Math.floor(combo / ANIMALS.length);
  return `${animal}-${number}`;
};

/** Generates `count` distinct pseudonyms; the seed picks where the walk starts. */
export const generatePseudonyms = (
  count: number,
  seed = Date.now() % MAX_PSEUDONYMS,
): readonly string[] => {
  if (!Number.isInteger(count) || count < 0 || count > MAX_PSEUDONYMS) {
    throw new Error(
      `generatePseudonyms: count must be between 0 and ${MAX_PSEUDONYMS}, got ${count}`,
    );
  }
  return Array.from({ length: count }, (_, index) => pseudonymAt(index, seed));
};
