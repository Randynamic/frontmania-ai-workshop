import { describe, expect, test } from 'vitest';
import { decodeEntities, htmlToText, parseSessions, slotFor, toLocalTime } from './parse.js';

const block = (
  id: string,
  extra: Partial<Record<'time' | 'title' | 'room' | 'speakers', string>> = {},
) => `
<li id="sz-session-${id}" data-sessionid="${id}" class="sz-session sz-session--full">
  <ul class="sz-session__speakers">${
    extra.speakers ??
    '<li data-speakerid="x"> <a href="#" onclick="return 1;">Ada &amp; Bo</a> </li>'
  }</ul>
  <h3 class="sz-session__title"> ${extra.title ?? 'Signals &amp; stores'} </h3>
  <p class="sz-session__description">First line.<br><br>Second &quot;line&quot;.</p>
  <div data-roomid="1" class="sz-session__room">${extra.room ?? 'Mission 1'}</div>
  <div class="sz-session__time" data-sztz="DayTime|en-NL|${
    extra.time ?? '2026-10-07T12:15:00.0000000Z|2026-10-07T13:00:00.0000000Z'
  }">Wed 14:15 - 15:00</div>
  <ul class="sz-session__tags"></ul>
  <dl class="sz-session__questions"> </dl>
</li>`;

describe('parseSessions', () => {
  test('extracts id, title, speakers, abstract, room and local time from one block', () => {
    // Arrange
    const html = `<ul>${block('1249439')}</ul>`;

    // Act
    const [session] = parseSessions(html);

    // Assert
    expect(session).toEqual({
      sessionId: '1249439',
      title: 'Signals & stores',
      speakers: ['Ada & Bo'],
      abstract: 'First line.\n\nSecond "line".',
      room: 'Mission 1',
      startUtc: '2026-10-07T12:15:00.000Z',
      endUtc: '2026-10-07T13:00:00.000Z',
      startTime: '14:15',
      durationMin: 45,
    });
  });

  test('parses several blocks in document order', () => {
    // Act
    const sessions = parseSessions(block('1') + block('2') + block('3'));

    // Assert
    expect(sessions.map((s) => s.sessionId)).toEqual(['1', '2', '3']);
  });

  test('normalises the 2025 embed (en-US, 12-hour print) from the ISO attribute', () => {
    // Arrange
    const html = block('1015048', {
      time: '2025-10-08T13:45:00.0000000Z|2025-10-08T14:00:00.0000000Z',
    });

    // Act
    const [session] = parseSessions(html);

    // Assert
    expect(session?.startTime).toBe('15:45');
    expect(session?.durationMin).toBe(15);
  });

  test('throws when the embed contains no session blocks', () => {
    expect(() => parseSessions('<div class="sz-root"></div>')).toThrow(/no sz-session/);
  });

  test('throws naming the session when a required field is missing', () => {
    const noSpeakers = block('77', { speakers: '' });
    expect(() => parseSessions(noSpeakers)).toThrow(/session 77: no speakers/);
    const noTime = block('78').replace(/data-sztz="[^"]*"/, '');
    expect(() => parseSessions(noTime)).toThrow(/session 78: missing time/);
  });
});

describe('slotFor', () => {
  test.each([
    ['14:15', '14:15'],
    ['14:40', '14:15'],
    ['15:29', '14:15'],
    ['15:30', '15:30'],
    ['16:29', '15:30'],
    ['16:30', '16:30'],
    ['17:00', '16:30'],
  ])('buckets %s into slot %s', (start, slot) => {
    expect(slotFor(start)).toBe(slot);
  });

  test('returns undefined before the first slot', () => {
    expect(slotFor('12:00')).toBeUndefined();
    expect(slotFor('13:30')).toBeUndefined();
  });
});

describe('text helpers', () => {
  test('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b &#39;c&#x2019; &nbsp;d &unknown;')).toBe(
      "a & b 'c’  d &unknown;",
    );
  });

  test('turns <br> into newlines and drops other tags', () => {
    expect(htmlToText('One<br><br>Two <em>three</em><br>')).toBe('One\n\nTwo three');
  });

  test('renders UTC in the event time zone (CEST in October)', () => {
    expect(toLocalTime('2026-10-07T07:40:00Z')).toBe('09:40');
  });
});
