import { FEEDBACK_PREFIX, MAX_REASON_LENGTH } from '../../src/schemas/feedback.js';
import { SLOTS, type Slot } from '../../src/schemas/talk.js';

/**
 * The user's verdicts on a plan, one per slot, and the turn-2 message that
 * carries them to the planner agent. `--feedback "up:reason;down:reason;up:reason"`
 * gives them in SLOTS order; the interactive prompt builds the same list.
 */
export const THUMBS = ['up', 'down'] as const;
export type Thumb = (typeof THUMBS)[number];

export interface Verdict {
  readonly slot: Slot;
  readonly thumb: Thumb;
  readonly reason: string;
}

export const FEEDBACK_FLAG_HINT =
  '--feedback "up:fits my stack;down:too basic;up:accessibility" (one verdict per slot, in the order 14:15;15:30;16:30)';

const isThumb = (value: string): value is Thumb => (THUMBS as readonly string[]).includes(value);

/** Semicolons separate verdicts in the message, so a reason never carries one. */
export const cleanReason = (reason: string): string =>
  reason.replace(/;/g, ',').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_LENGTH);

/** One verdict from the terminal or the flag; throws a message that says what to type. */
export const toVerdict = (slot: Slot, thumb: string, reason: string): Verdict => {
  const normalized = thumb.trim().toLowerCase();
  if (!isThumb(normalized)) throw new Error(`${slot}: thumb must be up or down, got "${thumb}"`);
  const cleaned = cleanReason(reason);
  if (!cleaned) throw new Error(`${slot}: give a short reason with the thumb`);
  return { slot, thumb: normalized, reason: cleaned };
};

export const parseFeedbackFlag = (value: string): readonly Verdict[] => {
  const parts = value.split(';').map((part) => part.trim());
  if (parts.length !== SLOTS.length) {
    throw new Error(
      `expected ${SLOTS.length} verdicts, got ${parts.length}: ${FEEDBACK_FLAG_HINT}`,
    );
  }
  return SLOTS.map((slot, index) => {
    const part = parts[index] as string;
    const colon = part.indexOf(':');
    if (colon < 0) throw new Error(`${slot}: expected thumb:reason, got "${part}"`);
    return toVerdict(slot, part.slice(0, colon), part.slice(colon + 1));
  });
};

/** "Feedback on my plan: 14:15 up because …; 15:30 down because …; 16:30 up because …" */
export const feedbackMessage = (verdicts: readonly Verdict[]): string =>
  `${FEEDBACK_PREFIX} ${verdicts.map((v) => `${v.slot} ${v.thumb} because ${v.reason}`).join('; ')}`;

/** One question to the user; the terminal's readline in `pnpm ask`, a script in tests. */
export type AskLine = (prompt: string) => Promise<string>;

/**
 * Asks thumb and reason for one slot until they form a valid verdict. A typo
 * ("y", "+1", an empty reason) shows what to type and asks the same slot
 * again, so the paid turn-1 plan is never thrown away.
 */
export const promptVerdict = async (
  slot: Slot,
  ask: AskLine,
  report: (message: string) => void,
): Promise<Verdict> => {
  const thumb = await ask(`${slot} thumb (up/down): `);
  const reason = await ask(`${slot} reason: `);
  try {
    return toVerdict(slot, thumb, reason);
  } catch (error) {
    report(`${error instanceof Error ? error.message : String(error)}; try ${slot} again`);
    return promptVerdict(slot, ask, report);
  }
};

/** The three verdicts in SLOTS order, each re-asked until valid. */
export const promptVerdicts = async (
  ask: AskLine,
  report: (message: string) => void,
): Promise<readonly Verdict[]> =>
  SLOTS.reduce<Promise<readonly Verdict[]>>(
    async (previous, slot) => [...(await previous), await promptVerdict(slot, ask, report)],
    Promise.resolve([]),
  );
