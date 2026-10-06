import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { isCommonTerm } from './common-terms.js';
import { identityHintPattern, identityHintPatterns, identityHints } from './identity-hints.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const cvText = fixture('fictional-cv.md');
const plainCv = fixture('plain-text-cv.txt');
const PERSONA_DIR = fileURLToPath(new URL('../../data/cvs/', import.meta.url));

/** The validator's probe: no markdown, a document title first, "Role - Employer" and "at Employer". */
const PROBE_CV = [
  'CURRICULUM VITAE',
  'Jan de Vries',
  '',
  'Senior Frontend Engineer - Bol.com',
  'Before that I was a developer at Coolblue.',
].join('\n');

/** Words a profile needs: they must never become hints. */
const ORDINARY_WORDS = [
  'React',
  'TypeScript',
  'Next.js',
  'Angular',
  'Senior',
  'Frontend',
  'Front-end',
  'Engineer',
  'Architect',
  'Design',
  'Accessibility',
  'Summary',
  'Experience',
  'Curriculum',
  'Vitae',
];

describe('identityHints on the markdown fixture', () => {
  test('finds the name, its hyphenated parts, the employers and the places', () => {
    const hints = identityHints(cvText);
    for (const hint of [
      'Femke',
      'Oosterhuis',
      'Bakker',
      'Femke Oosterhuis-Bakker',
      'Kanaalwerk',
      'Kanaalwerk Digital',
      'Groenlicht Studio',
      'Bytebrouwerij',
      'Amsterdam',
    ]) {
      expect(hints, hint).toContain(hint);
    }
  });

  test('never lists headings, titles, technologies or words the text also writes in lowercase', () => {
    const hints = identityHints(cvText);
    for (const word of ORDINARY_WORDS) expect(hints, word).not.toContain(word);
    expect(new Set(hints).size).toBe(hints.length);
  });
});

describe('identityHints on a plain-text CV', () => {
  test('reads the name under a CURRICULUM VITAE title and the employers after " - " and "at"', () => {
    expect(identityHints(PROBE_CV)).toEqual(
      expect.arrayContaining(['Jan', 'Vries', 'Jan de Vries', 'Bol.com', 'Bol', 'Coolblue']),
    );
  });

  test('the plain-text fixture yields name, employers and city, and no ordinary words', () => {
    const hints = identityHints(plainCv);
    expect(hints).toEqual(
      expect.arrayContaining([
        'Jan de Vries',
        'Winkelwagen.nl',
        'Winkelwagen',
        'Koelblauw',
        'Pakketpost',
        'Utrecht',
      ]),
    );
    for (const word of [...ORDINARY_WORDS, 'CURRICULUM', 'VITAE', 'PROFILE', 'Rebuilt', 'Owned']) {
      expect(hints, word).not.toContain(word);
    }
  });

  test('skips a bullet-opening verb and a compound of known words', () => {
    const text =
      'header line\nsecond line\nthird line\nArchitected the platform.\nAI-generated UI reviews.';
    expect(identityHints(text)).toEqual([]);
  });
});

describe('identityHints on a single line', () => {
  test('typed skills have no header, so only unknown capitalised words count', () => {
    expect(identityHints('React Next.js TypeScript')).toEqual([]);
    expect(
      identityHints('Twelve years of React and Next.js, I run the platform team at Kanaalwerk'),
    ).toEqual(['Kanaalwerk']);
  });
});

describe('identityHints on the persona CVs', () => {
  test('every persona name is a hint and no technology or topic word is', () => {
    const personas = readdirSync(PERSONA_DIR).filter((file) => file.endsWith('.md'));
    expect(personas.length).toBeGreaterThan(0);
    for (const file of personas) {
      const text = readFileSync(`${PERSONA_DIR}${file}`, 'utf8');
      const hints = identityHints(text);
      const nameLine = text.split('\n').find((line) => line.startsWith('# ')) ?? '';
      expect(hints, file).toContain(nameLine.replace(/^#\s*/, '').trim());
      expect(hints.filter(isCommonTerm), file).toEqual([]);
    }
  });
});

describe('identityHintPattern', () => {
  test('matches any letter case on word boundaries and escapes regex characters', () => {
    expect(
      'Kanaalwerk DIGITAL, kanaalwerk digital'.match(identityHintPattern('Kanaalwerk Digital')),
    ).toHaveLength(2);
    expect('Femkes'.match(identityHintPattern('Femke'))).toBeNull();
    expect('a.b and axb'.match(identityHintPattern('a.b'))).toEqual(['a.b']);
  });

  test('lists the patterns of a text longest hint first', () => {
    const patterns = identityHintPatterns(cvText);
    const lengths = patterns.map((pattern) => pattern.source.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(patterns.some((pattern) => pattern.source.includes('Femke Oosterhuis-Bakker'))).toBe(
      true,
    );
    expect(patterns).toHaveLength(identityHints(cvText).length);
  });
});
