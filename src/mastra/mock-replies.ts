import { tokenize } from '../data/embedding.js';
import type { MockPrompt } from './model.js';

/**
 * Canned answers for MODEL_MODE=mock, routed by what the prompt asks for.
 * The two markers below are sentences of the seed templates
 * (src/prompts/seed.ts), which mock mode always renders, so the mock can
 * tell a ranking request from a tip request without knowing the agent.
 * The ranking is deterministic and mildly sensible: talks whose line shares
 * words with the profile's interests rank first, avoid words push down.
 */
export const RANKER_PROMPT_MARKER = 'Rank every talk in this slot';
export const TIP_PROMPT_MARKER = 'Candidate recordings';
export const MOCK_CONFIDENCE = 0.5;

const SLOT_LINE = /^Slot: (14:15|15:30|16:30)$/m;
const TOP_PICK_LINE = /^Top pick: (.*)$/m;
const ID_LINE = /^- \[(fm\d{2}-[a-z0-9-]+)\] (.*)$/gm;
const PROFILE_BLOCK = /^\{[^\n]*\}$/m;

/** Every text part of every message, joined; what the mock "reads". */
export const promptText = (prompt: MockPrompt): string =>
  prompt
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content
            .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
            .join(' '),
    )
    .join('\n');

export const profileReply = (): string =>
  JSON.stringify({
    role: 'front-end developer',
    seniority: 'medior',
    stack: ['typescript', 'react'],
    interests: ['accessibility', 'performance'],
    avoid: [],
  });

interface ProfileWords {
  readonly interests: readonly string[];
  readonly avoid: readonly string[];
}

const wordsOf = (values: unknown): readonly string[] =>
  Array.isArray(values) ? values.flatMap((v) => (typeof v === 'string' ? tokenize(v) : [])) : [];

const profileWords = (text: string): ProfileWords => {
  const block = PROFILE_BLOCK.exec(text)?.[0];
  if (!block) return { interests: [], avoid: [] };
  try {
    const parsed = JSON.parse(block) as { interests?: unknown; avoid?: unknown };
    return { interests: wordsOf(parsed.interests), avoid: wordsOf(parsed.avoid) };
  } catch {
    return { interests: [], avoid: [] };
  }
};

const overlap = (line: string, words: readonly string[]): number => {
  const lineWords = new Set(tokenize(line));
  return words.filter((word) => lineWords.has(word)).length;
};

const idLines = (text: string): readonly { id: string; line: string }[] =>
  [...text.matchAll(ID_LINE)].map((match) => ({
    id: match[1] as string,
    line: match[2] as string,
  }));

const slotOf = (text: string): string => SLOT_LINE.exec(text)?.[1] ?? '14:15';

export const rankingReply = (text: string): string => {
  const words = profileWords(text);
  const ranked = idLines(text)
    .map((talk, index) => ({
      ...talk,
      index,
      score: overlap(talk.line, words.interests) - overlap(talk.line, words.avoid),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const top = ranked[0];
  return JSON.stringify({
    slot: slotOf(text),
    ranking: ranked.map((talk) => talk.id),
    reason: top
      ? `mock ranking: ${top.id} shares the most words with the interests`
      : 'mock ranking: no talks found in the prompt',
    confidence: MOCK_CONFIDENCE,
  });
};

export const tipReply = (text: string): string => {
  const topPick = tokenize(TOP_PICK_LINE.exec(text)?.[1] ?? '');
  const best = idLines(text)
    .map((candidate, index) => ({ ...candidate, index, score: overlap(candidate.line, topPick) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  return JSON.stringify({
    slot: slotOf(text),
    archiveTalkId: best?.id ?? 'fm25-none',
    why: best
      ? `mock tip: ${best.id} shares the most words with the top pick`
      : 'mock tip: no candidates in the prompt',
  });
};

/** The default mock answer: a profile for a CV, a ranking or a tip for the two registry prompts. */
export const routedMockReply = (prompt: MockPrompt): string => {
  const text = promptText(prompt);
  if (text.includes(TIP_PROMPT_MARKER)) return tipReply(text);
  if (text.includes(RANKER_PROMPT_MARKER)) return rankingReply(text);
  return profileReply();
};
