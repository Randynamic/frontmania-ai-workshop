import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import type { AnySpan } from '@mastra/core/observability';
import {
  CvMaskingProcessor,
  hintSecretsFor,
  MIN_LINE_LENGTH,
  maskValue,
  secretsFor,
} from './mask.js';
import { clearRawTextRegistry, HASH_PREFIX, registerRawText } from './raw-text-registry.js';

const CV_PATH = fileURLToPath(new URL('./fixtures/fictional-cv.md', import.meta.url));
const cvText = readFileSync(CV_PATH, 'utf8');
const plainCv = readFileSync(
  fileURLToPath(new URL('./fixtures/plain-text-cv.txt', import.meta.url)),
  'utf8',
);

const longLines = cvText
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length >= MIN_LINE_LENGTH);

/** A span shaped like the fields the processor reads; behaviour methods are not needed. */
const buildSpan = (text: string): AnySpan =>
  ({
    id: 'span-1',
    traceId: 'trace-1',
    name: 'agent run: profile',
    type: 'agent_run',
    startTime: new Date('2026-10-07T09:15:00Z'),
    isEvent: false,
    isInternal: false,
    input: { messages: [{ role: 'user', content: text }] },
    output: JSON.stringify({ role: 'Senior Front-end Architect', echo: text }),
    attributes: { prompt: `Extract a profile from:\n${text}`, model: 'talk-picker-task' },
    metadata: { participantId: 'otter-42', kind: 'profile' },
    errorInfo: { message: `Zod error while parsing ${text.slice(0, 120)}` },
    requestContext: { raw: text },
  }) as unknown as AnySpan;

afterEach(() => clearRawTextRegistry());

describe('CvMaskingProcessor', () => {
  test('returns the same span instance, as the SpanOutputProcessor contract requires', () => {
    // Arrange
    registerRawText(cvText);
    const span = buildSpan(cvText);
    const processor = new CvMaskingProcessor();

    // Act
    const result = processor.process(span);

    // Assert
    expect(result).toBe(span);
  });

  test('no line of the CV with length >= 20 survives in any span field', () => {
    // Arrange
    registerRawText(cvText);
    const span = buildSpan(cvText);

    // Act
    new CvMaskingProcessor().process(span);
    const serialized = JSON.stringify(span);

    // Assert
    expect(longLines.length).toBeGreaterThan(20);
    for (const line of longLines) {
      expect(serialized, `line survived: ${line}`).not.toContain(line);
    }
  });

  test('masks the name, the email and the phone number even though they are short', () => {
    // Arrange
    registerRawText(cvText);
    const span = buildSpan(cvText);

    // Act
    new CvMaskingProcessor().process(span);
    const serialized = JSON.stringify(span);

    // Assert
    expect(serialized).not.toContain('Femke Oosterhuis');
    expect(serialized).not.toContain('femke.oosterhuis@example.org');
    expect(serialized).not.toContain('0000 0009');
    expect(serialized).not.toContain('femke-oosterhuis-example');
    expect(serialized).not.toContain('Kanaalwerk');
  });

  test('replaces the CV with its hash marker and keeps the pseudonym metadata', () => {
    // Arrange
    const handle = registerRawText(cvText);
    const span = buildSpan(cvText);

    // Act
    const result = new CvMaskingProcessor().process(span) as unknown as {
      input: { messages: { content: string }[] };
      metadata: { participantId: string };
      attributes: { model: string };
    };

    // Assert
    expect(handle.marker).toContain(HASH_PREFIX);
    expect(result.input.messages[0]?.content.trim()).toBe(handle.marker);
    expect(result.metadata.participantId).toBe('otter-42');
    expect(result.attributes.model).toBe('talk-picker-task');
  });

  test('masks the CV when it is JSON-escaped inside a string field', () => {
    // Arrange
    const handle = registerRawText(cvText);
    const span = buildSpan('unused');
    (span as unknown as { output: string }).output = JSON.stringify({ messages: [cvText] });

    // Act
    new CvMaskingProcessor().process(span);

    // Assert
    const output = (span as unknown as { output: string }).output;
    expect(output).toContain(handle.hash);
    for (const line of longLines) expect(output).not.toContain(line);
  });

  test('masks a bare name or employer that a model echoes in the output field', () => {
    // Arrange: the probe from the validator round; no full CV line, only fragments
    const handle = registerRawText(cvText);
    const span = buildSpan('unused');
    (span as unknown as { output: string }).output = JSON.stringify({
      role: 'Lead Front-end Architect at Kanaalwerk Digital',
      note: 'Femke Oosterhuis, previously Groenlicht Studio, wants accessibility talks',
    });

    // Act
    new CvMaskingProcessor().process(span);
    const output = (span as unknown as { output: string }).output;

    // Assert
    for (const fragment of ['Femke', 'Oosterhuis', 'Kanaalwerk', 'Groenlicht']) {
      expect(output, `fragment survived: ${fragment}`).not.toContain(fragment);
    }
    expect(output).toContain(handle.marker);
    expect(output).toContain('Lead Front-end Architect at ');
    expect(output).toContain('wants accessibility talks');
  });

  test('masks a name and employers echoed from a plain-text CV with a CURRICULUM VITAE title', () => {
    // Arrange: no markdown; the name is on line 2, employers follow " - " and "at"
    const handle = registerRawText(plainCv);
    const span = buildSpan('unused');
    (span as unknown as { output: string }).output = JSON.stringify({
      role: 'Senior Frontend Engineer at Koelblauw',
      interests: ['checkout flows at Winkelwagen.nl', 'Jan de Vries talks', 'design systems'],
    });

    // Act
    new CvMaskingProcessor().process(span);
    const output = (span as unknown as { output: string }).output;

    // Assert
    for (const fragment of ['Koelblauw', 'Winkelwagen', 'Jan de Vries', 'Vries']) {
      expect(output, `fragment survived: ${fragment}`).not.toContain(fragment);
    }
    expect(output).toContain(`Senior Frontend Engineer at ${handle.marker}`);
    expect(output).toContain('design systems');
  });

  test('does not mask ordinary skill words when only a skills line was registered', () => {
    // Arrange
    registerRawText('React Next.js TypeScript');
    const span = buildSpan('unused');
    (span as unknown as { output: string }).output = 'stack: React, TypeScript';

    // Act
    new CvMaskingProcessor().process(span);

    // Assert
    expect((span as unknown as { output: string }).output).toBe('stack: React, TypeScript');
  });

  test('masks typed skills registered without a CV', () => {
    // Arrange
    const skills = 'Twelve years of React and Next.js, I run the platform team at Kanaalwerk';
    const handle = registerRawText(skills);
    const span = buildSpan(skills);

    // Act
    new CvMaskingProcessor().process(span);

    // Assert
    expect(JSON.stringify(span)).not.toContain('Kanaalwerk');
    expect(JSON.stringify(span)).toContain(handle.marker);
  });

  test('leaves unrelated strings and non-string values untouched', () => {
    // Arrange
    registerRawText(cvText);
    const span = buildSpan('hello');
    (span as unknown as { output: unknown }).output = {
      count: 3,
      ok: true,
      when: new Date('2026-10-07T09:00:00Z'),
      nothing: null,
      text: 'A talk about server components',
    };

    // Act
    new CvMaskingProcessor().process(span);

    // Assert
    expect((span as unknown as { output: Record<string, unknown> }).output).toEqual({
      count: 3,
      ok: true,
      when: new Date('2026-10-07T09:00:00Z'),
      nothing: null,
      text: 'A talk about server components',
    });
  });

  test('passes an undefined span through and shuts down cleanly', async () => {
    // Arrange
    const processor = new CvMaskingProcessor();

    // Act
    const result = processor.process(undefined);

    // Assert
    expect(result).toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
    expect(processor.name).toBe('cv-masking');
  });
});

describe('maskValue', () => {
  test('does not mutate its input', () => {
    // Arrange
    const handle = registerRawText(cvText);
    const secrets = secretsFor(cvText, handle);
    const input = { nested: [{ text: cvText }] };

    // Act
    const output = maskValue(input, secrets) as typeof input;

    // Assert
    expect(input.nested[0]?.text).toBe(cvText);
    expect(output.nested[0]?.text).toBe(handle.marker);
  });

  test('masks a name or employer echoed in another letter case, not a longer word', () => {
    // Arrange
    const handle = registerRawText(cvText);
    const secrets = secretsFor(cvText, handle);
    const hints = hintSecretsFor(cvText, handle.marker);
    const input = { role: 'lead architect at KANAALWERK digital', note: 'femke; femkes-style' };

    // Act
    const output = maskValue(input, secrets, hints) as typeof input;

    // Assert
    expect(output.role).toBe(`lead architect at ${handle.marker}`);
    expect(output.note).toBe(`${handle.marker}; femkes-style`);
  });

  test('masks emails and phone numbers that were never registered', () => {
    // Act
    const output = maskValue('mail sanne.dv@example.org or call +31 20 123 4567 today', []);

    // Assert
    expect(output).toBe('mail [email] or call [phone] today');
  });
});

describe('registerRawText', () => {
  test('returns the same handle for the same text and rejects empty text', () => {
    // Act
    const first = registerRawText(cvText);
    const second = registerRawText(`${cvText}\n`);

    // Assert
    expect(second).toEqual(first);
    expect(() => registerRawText('   ')).toThrow(/empty/);
  });
});
