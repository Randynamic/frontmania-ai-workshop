import type { Mastra } from '@mastra/core';
import { backendConfigFrom, type BackendConfig } from '../../src/backend/client.js';
import { fetchParticipantId } from '../../src/backend/whoami.js';
import { setCurrentRun } from '../../src/feedback/current-run.js';
import { modelModeFrom } from '../../src/mastra/model.js';
import type { TokenTallyExporter } from '../../src/observability/token-tally.js';
import { registerRun, RUN_DIR, writeLastRun } from '../../src/run/record.js';
import { toMlflowTraceId } from '../../src/trace-id.js';
import { parseArgs } from '../lib/args.js';
import { MOCK_PARTICIPANT_ID } from '../profile/run.js';
import { feedbackMessage, parseFeedbackFlag, type Verdict } from './verdicts.js';

/**
 * pnpm ask "<question>" [--feedback "up:reason;down:reason;up:reason"]
 *
 * Two turns with the planner agent (exercise 3). Turn 1 sends the question;
 * the agent calls its tools and answers with a plan. That run is registered
 * and becomes the current run, so the verdicts attach to the plan's trace.
 * Turn 2 sends the verdicts as one message, with turn 1 as history, and the
 * agent calls submitFeedback once per slot. Writes `.talk-picker/last-agent.json`.
 */
export const DEFAULT_QUESTION = 'plan my afternoon, no Angular, something on accessibility';
/** Upper bound on model calls per turn (agent.types.d.ts: `maxSteps?: number`). */
export const MAX_AGENT_STEPS = 12;
export const PLANNER_AGENT_KEY = 'planner';

export interface AskRunDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly mastra: Mastra;
  readonly tally?: TokenTallyExporter;
  /** Asks the user for three verdicts after printing the plan; used when --feedback is absent. */
  readonly askVerdicts?: (answer: string) => Promise<readonly Verdict[]>;
  /** Called with the plan before the verdicts are asked. */
  readonly onAnswer?: (answer: string) => void;
  readonly runDir?: string;
  readonly backend?: BackendConfig;
  readonly now?: () => number;
}

export interface SubmittedFeedback {
  readonly slot: string;
  readonly thumb: string;
  readonly ok: boolean;
}

export interface AskRunResult {
  readonly question: string;
  readonly answer: string;
  readonly confirmation: string;
  readonly toolCalls: readonly string[];
  readonly feedbackCalls: readonly SubmittedFeedback[];
  readonly participantId: string;
  readonly traceId: string;
  /** Tokens of turn 1 (the plan); null without a tally. */
  readonly tokens: number | null;
  /** Tokens of turn 2 (the verdicts and submitFeedback calls); null without a tally. */
  readonly tokensTurn2: number | null;
  /** Model calls of both turns together (one per agent step). */
  readonly modelCalls: number;
  readonly latencyMs: number;
}

interface StepLike {
  readonly toolCalls?: readonly { readonly payload?: { toolName?: string; args?: unknown } }[];
  readonly toolResults?: readonly {
    readonly payload?: { toolName?: string; args?: unknown; result?: unknown };
  }[];
}

/** Tool names in call order across every step of one generate call. */
export const toolCallOrder = (steps: readonly StepLike[]): readonly string[] =>
  steps.flatMap((step) => (step.toolCalls ?? []).map((c) => c.payload?.toolName ?? '?'));

/** What submitFeedback returned per call: the slot and thumb it was given and whether the backend said ok. */
export const submittedFeedback = (steps: readonly StepLike[]): readonly SubmittedFeedback[] =>
  steps.flatMap((step) =>
    (step.toolResults ?? [])
      .filter((r) => r.payload?.toolName === 'submitFeedback')
      .map((r) => {
        const args = (r.payload?.args ?? {}) as { slot?: unknown; thumb?: unknown };
        const result = r.payload?.result as { ok?: unknown } | undefined;
        return {
          slot: String(args.slot ?? '?'),
          thumb: String(args.thumb ?? '?'),
          ok: result?.ok === true,
        };
      }),
  );

const questionFrom = (positional: readonly string[]): string => {
  const joined = positional.join(' ').trim();
  return joined || DEFAULT_QUESTION;
};

/** Where the turn-2 verdicts come from: the flag (parsed now) or the terminal (asked after the plan). */
type VerdictSource = (answer: string) => Promise<readonly Verdict[]>;

/**
 * Decided before turn 1, so a missing terminal or a malformed --feedback
 * fails before any model call is spent.
 */
export const verdictSourceFor = (
  flag: string | true | undefined,
  askVerdicts: AskRunDeps['askVerdicts'],
): VerdictSource => {
  if (typeof flag === 'string') {
    const verdicts = parseFeedbackFlag(flag);
    return async () => verdicts;
  }
  if (flag === true)
    throw new Error('--feedback needs a value, for example --feedback "up:x;down:y;up:z"');
  if (!askVerdicts) {
    throw new Error(
      'no terminal to ask for verdicts; pass --feedback "up:reason;down:reason;up:reason"',
    );
  }
  return askVerdicts;
};

const tallyTotal = (tally: TokenTallyExporter | undefined): number | null =>
  tally?.snapshot().total ?? null;

export const runAsk = async (argv: readonly string[], deps: AskRunDeps): Promise<AskRunResult> => {
  const now = deps.now ?? Date.now;
  const runDir = deps.runDir ?? RUN_DIR;
  const args = parseArgs(argv);
  const question = questionFrom(args.positional);
  const verdictsFor = verdictSourceFor(args.flags.feedback, deps.askVerdicts);
  const isMock = modelModeFrom(deps.env) === 'mock';
  const backend = isMock ? undefined : (deps.backend ?? backendConfigFrom(deps.env));
  const participantId = backend ? await fetchParticipantId(backend) : MOCK_PARTICIPANT_ID;
  const agent = deps.mastra.getAgent(PLANNER_AGENT_KEY);
  const tracingOptions = { metadata: { participantId, kind: 'agent' } };

  deps.tally?.reset();
  const started = now();
  const turn1 = await agent.generate(question, { maxSteps: MAX_AGENT_STEPS, tracingOptions });
  const latencyMs = now() - started;
  if (!turn1.traceId) {
    throw new Error(
      'the agent run produced no trace id; is observability configured in src/mastra/index.ts?',
    );
  }
  const traceId = toMlflowTraceId(turn1.traceId);
  const toolCalls = toolCallOrder(turn1.steps as readonly StepLike[]);
  const tokens = tallyTotal(deps.tally);
  const answer = turn1.text;
  const record = { traceId, tokens, latencyMs, answer, toolCalls, participantId, question };
  writeLastRun('agent', record, runDir);
  if (backend) await registerRun(traceId, 'agent', { config: backend });
  else setCurrentRun({ traceId, kind: 'agent' });

  deps.onAnswer?.(answer);
  const verdicts = await verdictsFor(answer);
  const turn2 = await agent.generate(
    [
      { role: 'user', content: question },
      { role: 'assistant', content: answer },
      { role: 'user', content: feedbackMessage(verdicts) },
    ],
    { maxSteps: MAX_AGENT_STEPS, tracingOptions },
  );
  await deps.mastra.shutdown();
  const feedbackCalls = submittedFeedback(turn2.steps as readonly StepLike[]);
  const total = tallyTotal(deps.tally);
  const tokensTurn2 = total === null ? null : total - (tokens ?? 0);
  const modelCalls = turn1.steps.length + turn2.steps.length;
  writeLastRun('agent', { ...record, feedbackCalls, tokensTurn2, modelCalls }, runDir);

  return {
    question,
    answer,
    confirmation: turn2.text,
    toolCalls,
    feedbackCalls,
    participantId,
    traceId,
    tokens,
    tokensTurn2,
    modelCalls,
    latencyMs,
  };
};

export const formatToolOrder = (toolCalls: readonly string[]): string =>
  toolCalls.length > 0 ? `tools: ${toolCalls.join(' -> ')}` : 'tools: none called';

export const formatFeedbackSummary = (calls: readonly SubmittedFeedback[]): string => {
  const accepted = calls.filter((c) => c.ok);
  const detail = calls.map((c) => `${c.slot} ${c.thumb}${c.ok ? '' : ' (not stored)'}`).join(', ');
  return `feedback: ${accepted.length} of 3 verdicts stored${detail ? ` (${detail})` : ''}`;
};

export const formatAskSummary = (result: AskRunResult): string =>
  [
    formatToolOrder(result.toolCalls),
    formatFeedbackSummary(result.feedbackCalls),
    `tokens: ${result.tokens ?? 'n/a'} + ${result.tokensTurn2 ?? 'n/a'} (turn 1 + turn 2)  model calls: ${result.modelCalls}  latency: ${result.latencyMs} ms (turn 1)`,
    `trace: ${result.traceId}  participant: ${result.participantId}`,
    'saved .talk-picker/last-agent.json',
  ].join('\n');
