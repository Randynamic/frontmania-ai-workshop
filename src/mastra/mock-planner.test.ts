import { describe, expect, test } from 'vitest';
import { FEEDBACK_PREFIX } from '../schemas/feedback.js';
import { avoidedWords, currentTurn, pickPerSlot, plannerMockContent } from './mock-planner.js';
import type { MockPrompt } from './model.js';

const ALL_TOOLS = ['getTimetable', 'searchArchive', 'submitFeedback'];
const talks = [
  { id: 'fm26-1', title: 'Angular signals deep dive', slot: '14:15' },
  { id: 'fm26-2', title: 'Accessible React components', slot: '14:15' },
  { id: 'fm26-3', title: 'CSS at scale', slot: '15:30' },
  { id: 'fm26-4', title: 'Web accessibility for zombies', slot: '16:30' },
];

const user = (text: string): MockPrompt[number] => ({
  role: 'user',
  content: [{ type: 'text', text }],
});
const toolResult = (toolName: string, value: unknown): MockPrompt[number] => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: `c-${toolName}`,
      toolName,
      output: { type: 'json', value: value as never },
    },
  ],
});
const callsOf = (content: ReturnType<typeof plannerMockContent>) =>
  content.flatMap((part) =>
    part.type === 'tool-call' ? [{ name: part.toolName, input: JSON.parse(part.input) }] : [],
  );

describe('mock planner, turn 1', () => {
  test('calls getTimetable first', () => {
    const content = plannerMockContent([user('plan my afternoon')], ALL_TOOLS);
    expect(callsOf(content)).toEqual([{ name: 'getTimetable', input: {} }]);
  });

  test('then one searchArchive per slot, then a text plan that respects "no Angular"', () => {
    // Arrange
    const question = 'plan my afternoon, no Angular';
    const afterTimetable = [user(question), toolResult('getTimetable', { talks })];

    // Act
    const searches = callsOf(plannerMockContent(afterTimetable, ALL_TOOLS));
    const final = plannerMockContent(
      [...afterTimetable, toolResult('searchArchive', { hits: [] })],
      ALL_TOOLS,
    );

    // Assert
    expect(searches.map((c) => c.name)).toEqual([
      'searchArchive',
      'searchArchive',
      'searchArchive',
    ]);
    expect(searches[0]!.input).toEqual({ queryText: 'Accessible React components', topK: 1 });
    const text = final[0]!.type === 'text' ? final[0]!.text : '';
    expect(text).toContain('14:15 [fm26-2]');
    expect(text).not.toContain('fm26-1');
  });

  test('without tools there is nothing to call and no timetable to plan from', () => {
    const content = plannerMockContent([user('plan my afternoon')], ['somethingElse']);
    expect(content).toEqual([
      { type: 'text', text: 'mock plan: I have no timetable to plan from.' },
    ]);
  });
});

describe('mock planner, turn 2', () => {
  const verdicts = `${FEEDBACK_PREFIX} 14:15 up because fits; 15:30 down because too basic; 16:30 up because a11y`;

  test('calls submitFeedback once per verdict', () => {
    const calls = callsOf(plannerMockContent([user(verdicts)], ALL_TOOLS));
    expect(calls).toEqual([
      { name: 'submitFeedback', input: { slot: '14:15', thumb: 'up', reason: 'fits' } },
      { name: 'submitFeedback', input: { slot: '15:30', thumb: 'down', reason: 'too basic' } },
      { name: 'submitFeedback', input: { slot: '16:30', thumb: 'up', reason: 'a11y' } },
    ]);
  });

  test('confirms after the results, and says so when the tool or the verdicts are missing', () => {
    const done = plannerMockContent(
      [user(verdicts), toolResult('submitFeedback', { ok: true })],
      ALL_TOOLS,
    );
    expect(done).toEqual([{ type: 'text', text: 'mock: recorded 1 verdict(s).' }]);
    expect(plannerMockContent([user(verdicts)], ['getTimetable'])[0]).toMatchObject({
      text: 'mock: I have no tool to record feedback.',
    });
    expect(plannerMockContent([user(`${FEEDBACK_PREFIX} nothing`)], ALL_TOOLS)[0]).toMatchObject({
      text: 'mock: I found no verdicts in your message.',
    });
  });
});

describe('helpers', () => {
  test('currentTurn only sees tool results after the last user message', () => {
    const turn = currentTurn([
      user('first'),
      toolResult('getTimetable', { talks }),
      user('second'),
    ]);
    expect(turn).toEqual({ question: 'second', results: [] });
    expect(currentTurn([])).toEqual({ question: '', results: [] });
  });

  test('avoidedWords and pickPerSlot', () => {
    expect(avoidedWords('No Angular, no vue please')).toEqual(['angular', 'vue']);
    expect(pickPerSlot(talks, 'no css').map((t) => t.id)).toEqual(['fm26-1', 'fm26-3', 'fm26-4']);
  });
});
