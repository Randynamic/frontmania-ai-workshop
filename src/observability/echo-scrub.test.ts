import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { scrubEchoedIdentity } from './echo-scrub.js';

const cvText = readFileSync(
  fileURLToPath(new URL('./fixtures/fictional-cv.md', import.meta.url)),
  'utf8',
);
const plainCv = readFileSync(
  fileURLToPath(new URL('./fixtures/plain-text-cv.txt', import.meta.url)),
  'utf8',
);
const MARKER = '[cv:sha256:0123456789ab]';

describe('scrubEchoedIdentity', () => {
  test('a name echoed as separate words becomes one marker, not one per word', () => {
    // Arrange: first and last name match as two hints
    const profile = { interests: ['talks femke oosterhuis would pick'] };

    // Act
    const result = scrubEchoedIdentity(profile, cvText, MARKER);

    // Assert
    expect(result.value.interests).toEqual([`talks ${MARKER} would pick`]);
  });

  test('replaces an employer echoed inside a value with the marker', () => {
    // Arrange
    const profile = {
      role: 'Lead Front-end Architect at Kanaalwerk Digital',
      stack: ['React'],
    };

    // Act
    const result = scrubEchoedIdentity(profile, cvText, MARKER);

    // Assert
    expect(result.value.role).toBe(`Lead Front-end Architect at ${MARKER}`);
    expect(result.value.stack).toEqual(['React']);
    expect(result.replaced).toBe(1);
  });

  test('matches regardless of case and in nested arrays', () => {
    const profile = {
      interests: ['talks by femke oosterhuis', 'design systems like bytebrouwerij builds'],
    };
    const result = scrubEchoedIdentity(profile, cvText, MARKER);
    const serialized = JSON.stringify(result.value);
    expect(serialized.toLowerCase()).not.toContain('femke');
    expect(serialized.toLowerCase()).not.toContain('oosterhuis');
    expect(serialized.toLowerCase()).not.toContain('bytebrouwerij');
    expect(result.replaced).toBe(3);
  });

  test('masks emails and phone numbers in any value', () => {
    const result = scrubEchoedIdentity(
      { role: 'reach me at femke.oosterhuis@example.org or +31 6 0000 0009' },
      cvText,
      MARKER,
    );
    expect(result.value.role).toBe('reach me at [email] or [phone]');
    expect(result.replaced).toBe(2);
  });

  test('leaves words that only contain a hint alone and returns the input untouched', () => {
    // Arrange: "Femkes" is not the token "Femke"; the input object must not change
    const profile = Object.freeze({ role: 'Femkes-style architect', seniority: 'lead' });

    // Act
    const result = scrubEchoedIdentity(profile, cvText, MARKER);

    // Assert
    expect(result.value).toEqual({ role: 'Femkes-style architect', seniority: 'lead' });
    expect(result.value).not.toBe(profile);
    expect(result.replaced).toBe(0);
  });

  test('typed skills have no name line, so ordinary words survive', () => {
    const result = scrubEchoedIdentity(
      { stack: ['React', 'Next.js'], confidence: { role: 0.8 }, note: null },
      'React Next.js TypeScript',
      MARKER,
    );
    expect(result.value).toEqual({
      stack: ['React', 'Next.js'],
      confidence: { role: 0.8 },
      note: null,
    });
    expect(result.replaced).toBe(0);
  });

  test('a plain-text CV: the echoed name and employers are scrubbed, the topics survive', () => {
    // Arrange: the validator's probe shape, on a CV without any markdown
    const profile = {
      role: 'Senior Frontend Engineer at Koelblauw',
      seniority: 'senior',
      stack: ['React', 'Next.js'],
      interests: ['checkout flows at Winkelwagen.nl', 'Jan de Vries talks', 'design systems'],
      avoid: ['talks by winkelwagen'],
    };

    // Act
    const result = scrubEchoedIdentity(profile, plainCv, MARKER);

    // Assert
    expect(result.value).toEqual({
      role: `Senior Frontend Engineer at ${MARKER}`,
      seniority: 'senior',
      stack: ['React', 'Next.js'],
      interests: [`checkout flows at ${MARKER}`, `${MARKER} talks`, 'design systems'],
      avoid: [`talks by ${MARKER}`],
    });
    expect(result.replaced).toBe(4);
  });

  test('a CURRICULUM VITAE title does not hide the name on the next line', () => {
    const cv = 'CURRICULUM VITAE\nJan de Vries\n\nSenior Frontend Engineer - Bol.com\nat Coolblue';
    const result = scrubEchoedIdentity(
      { role: 'Senior Frontend Engineer at Coolblue', interests: ['jan de vries', 'Bol.com'] },
      cv,
      MARKER,
    );
    expect(JSON.stringify(result.value).toLowerCase()).not.toMatch(/coolblue|bol\.com|vries|jan/);
    expect(result.value.role).toBe(`Senior Frontend Engineer at ${MARKER}`);
  });
});
