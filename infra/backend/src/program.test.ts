import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadProgram, talkIdsBySlot } from './program.js';

const dir = mkdtempSync(join(tmpdir(), 'program-'));
const fixture = join(dir, 'fixture.json');
const real = join(dir, 'real.json');
writeFileSync(
  fixture,
  JSON.stringify({ fixture: true, talks: [{ id: 'f1', title: 'Fixture', slot: '14:15' }] }),
);

describe('loadProgram', () => {
  test('falls back to the fixture and flags it', () => {
    const loaded = loadProgram(join(dir, 'missing.json'), fixture);
    expect(loaded?.isFixture).toBe(true);
    expect(loaded?.program.slots).toEqual(['14:15', '15:30', '16:30']);
    expect(talkIdsBySlot(loaded!.program).get('14:15')?.has('f1')).toBe(true);
  });

  test('prefers the real snapshot and rejects invalid files', () => {
    writeFileSync(
      real,
      JSON.stringify({
        fixture: false,
        slots: ['14:15'],
        talks: [{ id: 'r1', title: 'Real', slot: '14:15', speakers: ['S'] }],
      }),
    );
    expect(loadProgram(real, fixture)?.isFixture).toBe(false);
    writeFileSync(real, JSON.stringify({ talks: [{ id: 'r1', title: 'Real', slot: '13:00' }] }));
    expect(() => loadProgram(real, fixture)).toThrow(/invalid/);
    expect(loadProgram(join(dir, 'a'), join(dir, 'b'))).toBeUndefined();
  });
});
