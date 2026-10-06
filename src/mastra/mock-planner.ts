import { FEEDBACK_PREFIX } from '../schemas/feedback.js';
import type { LanguageModelV4, MockPrompt } from './model.js';

/**
 * The scripted planner for MODEL_MODE=mock: what a tool-using model would do
 * with the planner's question, so `pnpm ask` and `pnpm check:03 --static`
 * exercise the real tools offline. It only calls tools the agent offers
 * (on 03-start the planner has none, so nothing is called).
 *
 * Turn 1 (any question): getTimetable, then searchArchive once per slot,
 * then a text plan with one talk per slot. Turn 2 (a message that starts
 * with FEEDBACK_PREFIX): one submitFeedback call per verdict, then a short
 * confirmation.
 */
const VERDICT = /(14:15|15:30|16:30) (up|down) because ([^;]+)/g;
const SLOT_ORDER = ['14:15', '15:30', '16:30'] as const;

type GenerateResult = Awaited<ReturnType<LanguageModelV4['doGenerate']>>;
export type MockContent = GenerateResult['content'];
type Message = MockPrompt[number];

interface ToolResult {
  readonly toolName: string;
  readonly value: unknown;
}

interface TimetableTalk {
  readonly id: string;
  readonly title: string;
  readonly slot: string;
}

const textOf = (message: Message): string =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
        .join(' ');

/** The last user message and the tool results that came after it (this turn's work so far). */
export const currentTurn = (
  prompt: MockPrompt,
): { readonly question: string; readonly results: readonly ToolResult[] } => {
  const lastUser = prompt.map((m) => m.role).lastIndexOf('user');
  const question = lastUser >= 0 ? textOf(prompt[lastUser] as Message) : '';
  const results = prompt.slice(lastUser + 1).flatMap((message) =>
    message.role === 'tool' && Array.isArray(message.content)
      ? message.content.flatMap((part) =>
          part.type === 'tool-result'
            ? [
                {
                  toolName: part.toolName,
                  value: 'value' in part.output ? part.output.value : undefined,
                },
              ]
            : [],
        )
      : [],
  );
  return { question, results };
};

const toolCall = (index: number, toolName: string, input: unknown): MockContent[number] => ({
  type: 'tool-call',
  toolCallId: `mock-call-${toolName}-${index}`,
  toolName,
  input: JSON.stringify(input),
});

const text = (value: string): MockContent => [{ type: 'text', text: value }];

/** Words after "no " in the question: the constraints the mock respects ("no Angular"). */
export const avoidedWords = (question: string): readonly string[] =>
  [...question.toLowerCase().matchAll(/\bno ([a-z0-9.+-]+)/g)].map((m) => m[1] as string);

const timetableTalks = (results: readonly ToolResult[]): readonly TimetableTalk[] => {
  const value = results.find((r) => r.toolName === 'getTimetable')?.value as
    { talks?: readonly TimetableTalk[] } | undefined;
  return value?.talks ?? [];
};

/** First talk per slot whose title avoids every "no <word>" in the question. */
export const pickPerSlot = (
  talks: readonly TimetableTalk[],
  question: string,
): readonly TimetableTalk[] => {
  const avoid = avoidedWords(question);
  return SLOT_ORDER.flatMap((slot) => {
    const options = talks.filter((t) => t.slot === slot);
    const allowed = options.find((t) => !avoid.some((w) => t.title.toLowerCase().includes(w)));
    const chosen = allowed ?? options[0];
    return chosen ? [chosen] : [];
  });
};

const planTurn = (
  question: string,
  results: readonly ToolResult[],
  tools: ReadonlySet<string>,
): MockContent => {
  const called = new Set(results.map((r) => r.toolName));
  if (tools.has('getTimetable') && !called.has('getTimetable')) {
    return [toolCall(0, 'getTimetable', {})];
  }
  const picks = pickPerSlot(timetableTalks(results), question);
  if (tools.has('searchArchive') && !called.has('searchArchive') && picks.length > 0) {
    return picks.map((talk, index) =>
      toolCall(index, 'searchArchive', { queryText: talk.title, topK: 1 }),
    );
  }
  if (picks.length === 0) return text('mock plan: I have no timetable to plan from.');
  const lines = picks.map((talk) => `${talk.slot} [${talk.id}] ${talk.title}`);
  return text(
    ['mock plan:', ...lines, 'Give me a thumb up or down per slot with a reason.'].join('\n'),
  );
};

const feedbackTurn = (
  question: string,
  results: readonly ToolResult[],
  tools: ReadonlySet<string>,
): MockContent => {
  const submitted = results.filter((r) => r.toolName === 'submitFeedback').length;
  if (submitted > 0) return text(`mock: recorded ${submitted} verdict(s).`);
  if (!tools.has('submitFeedback')) return text('mock: I have no tool to record feedback.');
  const verdicts = [...question.matchAll(VERDICT)].map((m) => ({
    slot: m[1] as string,
    thumb: m[2] as string,
    reason: (m[3] as string).trim(),
  }));
  if (verdicts.length === 0) return text('mock: I found no verdicts in your message.');
  return verdicts.map((verdict, index) => toolCall(index, 'submitFeedback', verdict));
};

/** One scripted model step for a tool-using agent. */
export const plannerMockContent = (
  prompt: MockPrompt,
  toolNames: readonly string[],
): MockContent => {
  const { question, results } = currentTurn(prompt);
  const tools = new Set(toolNames);
  return question.trimStart().startsWith(FEEDBACK_PREFIX)
    ? feedbackTurn(question, results, tools)
    : planTurn(question, results, tools);
};
