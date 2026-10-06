import { describe, expect, test } from 'vitest';
import type { Talk } from '../schemas/talk.js';
import {
  oneLine,
  promptVariables,
  renderPrompt,
  serializeProfile,
  serializeTalk,
  serializeTalks,
} from './render.js';

const talk: Talk = {
  id: 'fm26-1',
  title: 'Signals everywhere',
  speakers: ['Ada', 'Grace'],
  slot: '14:15',
  room: 'Quest',
  durationMin: 40,
  abstract: 'Signals in three frameworks.',
  startTime: '14:15',
  year: 2026,
};

describe('renderPrompt', () => {
  test('replaces every placeholder, tolerating spaces inside the braces', () => {
    expect(
      renderPrompt('Rank {{talks}} for {{ profile }}. {{talks}}', { talks: 'T', profile: 'P' }),
    ).toBe('Rank T for P. T');
    expect(promptVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });

  test('names every missing variable and leaves unknown syntax alone', () => {
    expect(() => renderPrompt('{{a}} {{b}}', { a: 'x' })).toThrow('missing variable b');
    expect(() => renderPrompt('{{a}} {{b}}', {})).toThrow('missing variables a, b');
    expect(renderPrompt('{a} {{{b}}}', { b: 'x' })).toBe('{a} {x}');
  });
});

describe('canonical serialisers (contract with optimize/)', () => {
  test('profile is compact JSON in key order', () => {
    expect(serializeProfile({ role: 'dev', stack: ['react', 'ts'] })).toBe(
      '{"role":"dev","stack":["react","ts"]}',
    );
  });

  test('talk lines follow the fixed format', () => {
    expect(serializeTalk(talk)).toBe(
      '- [fm26-1] Signals everywhere — Ada, Grace (Quest, 40 min): Signals in three frameworks.',
    );
    expect(serializeTalks([talk, { ...talk, id: 'fm26-2', title: 'Two' }])).toBe(
      `${serializeTalk(talk)}\n- [fm26-2] Two — Ada, Grace (Quest, 40 min): Signals in three frameworks.`,
    );
    expect(serializeTalks([])).toBe('');
  });

  test('abstracts with blank lines still make one line per talk', () => {
    expect(oneLine('  a\n\n  b\tc ')).toBe('a b c');
    const multi = { ...talk, abstract: 'First paragraph.\n\nSecond paragraph.' };
    expect(serializeTalks([multi, talk]).split('\n')).toHaveLength(2);
    expect(serializeTalk(multi)).toContain('First paragraph. Second paragraph.');
  });
});
