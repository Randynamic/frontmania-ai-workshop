import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { scrubEchoedIdentity } from './echo-scrub.js';
import { identityFields } from './identity-fields.js';
import { identityHints } from './identity-hints.js';
import { hintSecretsFor, maskValue, secretsFor } from './mask.js';
import { registerRawText, clearRawTextRegistry } from './raw-text-registry.js';

const pdfCv = readFileSync(
  fileURLToPath(new URL('./fixtures/pdf-export-cv.txt', import.meta.url)),
  'utf8',
);

/** The privacy validator's probes (finding I5): echoes a model may write alone. */
const PDF_ECHOES = [
  'Pieter van den Berg',
  'name pieter van den berg',
  'PIETER',
  'github.com/pvdb',
  'see https://github.com/pvdb for code',
  'handle pvdb',
  'linkedin.com/in/pieter-vdberg',
  'postcode 1015 CX',
  'lives in 1015cx',
  'frontend dev at coolblue',
  'Coolblue',
] as const;
const PDF_FRAGMENTS = ['pieter', 'berg', 'pvdb', '1015', 'coolblue', 'vdberg'] as const;

const maskAll = (rawText: string, values: readonly string[]): readonly string[] => {
  clearRawTextRegistry();
  const handle = registerRawText(rawText);
  const masked = maskValue(
    values,
    secretsFor(rawText, handle),
    hintSecretsFor(rawText, handle.marker),
  ) as readonly string[];
  clearRawTextRegistry();
  return masked;
};

const survivors = (values: readonly string[], fragments: readonly string[]): readonly string[] =>
  values.filter((value) => fragments.some((fragment) => value.toLowerCase().includes(fragment)));

describe('identityFields', () => {
  test('reads a labelled name in lowercase, links, handles, postcodes and the word after "at"', () => {
    const fields = identityFields(pdfCv);
    expect(fields).toEqual(
      expect.arrayContaining([
        'pieter van den berg',
        'pieter',
        'berg',
        'github.com/pvdb',
        'pvdb',
        'linkedin.com/in/pieter-vdberg',
        'pieter-vdberg',
        '1015 CX',
        '1015CX',
        'coolblue',
      ]),
    );
  });

  test('leaves particles, common words and "at scale" alone', () => {
    const fields = identityFields(pdfCv).map((field) => field.toLowerCase());
    for (const word of ['van', 'den', 'scale', 'a', 'react', 'typescript']) {
      expect(fields, word).not.toContain(word);
    }
  });

  test('reads @handles and Naam: labels, never an email address as a handle', () => {
    const fields = identityFields('Naam: Sanne de Wit\nX: @sannedw, mail sanne@example.org');
    expect(fields).toEqual(expect.arrayContaining(['Sanne de Wit', 'Sanne', 'Wit', '@sannedw']));
    expect(fields).not.toContain('example.org');
  });

  test('a year followed by a lowercase word is no postcode', () => {
    expect(identityFields('2015 to 2017 in Utrecht')).toEqual([]);
  });
});

describe('a PDF-export CV with a page header and a lowercase labelled name', () => {
  test('the trace masker leaves none of the name, handle, postcode or employer fragments', () => {
    expect(survivors(maskAll(pdfCv, PDF_ECHOES), PDF_FRAGMENTS)).toEqual([]);
  });

  test('the echo scrub leaves none of them in a profile either', () => {
    const profile = {
      role: 'frontend dev at coolblue',
      stack: ['react', 'pvdb tooling'],
      interests: ['Pieter van den Berg on design systems', 'meetups near 1015 CX'],
    };
    const { value } = scrubEchoedIdentity(profile, pdfCv, '[cv:sha256:test]');
    expect(JSON.stringify(value).toLowerCase()).not.toMatch(/pieter|berg|pvdb|1015|coolblue/);
    expect(value.stack).toContain('react');
  });

  test('a typed-skills line with "at coolblue" masks the employer echo', () => {
    const typed = 'react, typescript, design systems; frontend dev at coolblue';
    expect(identityHints(typed)).toContain('coolblue');
    expect(survivors(maskAll(typed, ['frontend dev at coolblue']), ['coolblue'])).toEqual([]);
  });
});
