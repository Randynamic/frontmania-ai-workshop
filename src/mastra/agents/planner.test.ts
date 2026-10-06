import { afterEach, describe, expect, test } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { clearCurrentRun, setCurrentRun } from '../../feedback/current-run.js';
import { clearSunkFeedback, sunkFeedback } from '../../feedback/sink.js';
import { FEEDBACK_PREFIX } from '../../schemas/feedback.js';
import { instructionsText } from '../../../scripts/check/01/static.js';
import { createMockTaskModel } from '../model.js';
import { createPlannerAgent, PLANNER_INSTRUCTIONS, plannerAgent } from './planner.js';

/** Exercise 3, step 2 (03-done only): three tools, instructions, the loop under a step cap. */
afterEach(() => {
  clearSunkFeedback();
  clearCurrentRun();
});

const toolNamesCalled = (
  steps: readonly { toolCalls?: readonly { payload?: { toolName?: string } }[] }[],
) => steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.payload?.toolName));

describe('planner agent', () => {
  test('has exactly the three tools', async () => {
    expect(Object.keys(await plannerAgent.listTools()).sort()).toEqual([
      'getTimetable',
      'searchArchive',
      'submitFeedback',
    ]);
  });

  test('instructions cover the order, all three slots and the feedback rule', async () => {
    const text = instructionsText(await plannerAgent.getInstructions());
    expect(text).toBe(PLANNER_INSTRUCTIONS);
    expect(text).toMatch(/getTimetable first/);
    expect(text).toMatch(/all three slots/);
    expect(text).toMatch(/submitFeedback once per slot/);
    expect(text).not.toMatch(/TODO/);
  });

  test('with the mock model it calls each tool across the two turns', async () => {
    // Arrange
    const agent = createPlannerAgent(createMockTaskModel());

    // Act
    const turn1 = await agent.generate('plan my afternoon, no Angular', { maxSteps: 12 });
    setCurrentRun({ traceId: 'tr-plan', kind: 'agent' });
    const turn2 = await agent.generate(
      `${FEEDBACK_PREFIX} 14:15 up because a; 15:30 down because b; 16:30 up because c`,
      { maxSteps: 12 },
    );

    // Assert
    expect(toolNamesCalled(turn1.steps)).toEqual([
      'getTimetable',
      'searchArchive',
      'searchArchive',
      'searchArchive',
    ]);
    expect(toolNamesCalled(turn2.steps)).toEqual([
      'submitFeedback',
      'submitFeedback',
      'submitFeedback',
    ]);
    expect(sunkFeedback().map((r) => r.slot)).toEqual(['14:15', '15:30', '16:30']);
    expect(turn1.text).toContain('14:15');
  });

  test('maxSteps caps the tool loop', async () => {
    // Arrange: a model that asks for the timetable forever
    let calls = 0;
    const looping = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        return {
          content: [
            { type: 'tool-call', toolCallId: `c${calls}`, toolName: 'getTimetable', input: '{}' },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });

    // Act
    await createPlannerAgent(looping).generate('plan', { maxSteps: 3 });

    // Assert
    expect(calls).toBe(3);
  });
});
