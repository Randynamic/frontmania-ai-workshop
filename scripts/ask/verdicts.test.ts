import { describe, expect, test } from 'vitest';
import {
  cleanReason,
  feedbackMessage,
  parseFeedbackFlag,
  promptVerdicts,
  toVerdict,
} from './verdicts.js';

describe('verdicts', () => {
  test('parses three verdicts in slot order from --feedback', () => {
    expect(parseFeedbackFlag('up:fits my stack; DOWN:too basic ;up:a11y: yes')).toEqual([
      { slot: '14:15', thumb: 'up', reason: 'fits my stack' },
      { slot: '15:30', thumb: 'down', reason: 'too basic' },
      { slot: '16:30', thumb: 'up', reason: 'a11y: yes' },
    ]);
  });

  test('names what is wrong: count, missing colon, thumb, empty reason', () => {
    expect(() => parseFeedbackFlag('up:a;down:b')).toThrow('expected 3 verdicts, got 2');
    expect(() => parseFeedbackFlag('up a;down:b;up:c')).toThrow('14:15: expected thumb:reason');
    expect(() => parseFeedbackFlag('meh:a;down:b;up:c')).toThrow('thumb must be up or down');
    expect(() => toVerdict('16:30', 'up', '   ')).toThrow('give a short reason');
  });

  test('reasons lose semicolons and are capped at 280 characters', () => {
    expect(cleanReason(' a;b\n c ')).toBe('a,b c');
    expect(cleanReason('x'.repeat(300))).toHaveLength(280);
  });

  test('builds the turn-2 message the planner reads', () => {
    const message = feedbackMessage(parseFeedbackFlag('up:a;down:b;up:c'));
    expect(message).toBe(
      'Feedback on my plan: 14:15 up because a; 15:30 down because b; 16:30 up because c',
    );
  });

  test('re-asks the same slot after a mistyped thumb or an empty reason', async () => {
    // Arrange: 14:15 gets "y", then an empty reason, then a valid answer
    const answers = ['y', 'fits', 'up', ' ', 'UP', 'fits', 'down', 'too basic', 'up', 'a11y'];
    const prompts: string[] = [];
    const reports: string[] = [];
    const ask = async (prompt: string) => {
      prompts.push(prompt);
      return answers.shift() ?? '';
    };

    // Act
    const verdicts = await promptVerdicts(ask, (message) => reports.push(message));

    // Assert
    expect(verdicts).toEqual([
      { slot: '14:15', thumb: 'up', reason: 'fits' },
      { slot: '15:30', thumb: 'down', reason: 'too basic' },
      { slot: '16:30', thumb: 'up', reason: 'a11y' },
    ]);
    expect(reports).toEqual([
      '14:15: thumb must be up or down, got "y"; try 14:15 again',
      '14:15: give a short reason with the thumb; try 14:15 again',
    ]);
    expect(prompts.filter((p) => p.startsWith('14:15 thumb'))).toHaveLength(3);
    expect(answers).toEqual([]);
  });
});
