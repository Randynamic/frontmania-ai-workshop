import { loadArchiveTalks } from '../../../src/data/archive.js';
import { loadProgram, talksForSlot } from '../../../src/data/program.js';
import type { Plan } from '../../../src/schemas/plan.js';
import { SLOTS } from '../../../src/schemas/talk.js';
import { assertion, type CheckLine } from '../lib.js';

export const TIPS_CHECK_NAME = 'three tips from the archive';
const UNKNOWN_TIP_DETAIL = 'a tip names an id that is not in the archive (step 3)';

/**
 * The tip assertion both layers make: exactly one tip per slot, each naming
 * an archive talk. `countDetail` words the count failure for its layer (the
 * live layer points at a stale last-plan.json from before step 3).
 */
export const tipsCheck = (plan: Plan, countDetail: (count: number) => string): CheckLine => {
  const archiveIds = new Set(loadArchiveTalks().talks.map((t) => t.id));
  const count = plan.tips.length;
  const isCountRight = count === SLOTS.length;
  const areIdsKnown = plan.tips.every((tip) => archiveIds.has(tip.archiveTalkId));
  return assertion(
    TIPS_CHECK_NAME,
    isCountRight && areIdsKnown,
    isCountRight ? UNKNOWN_TIP_DETAIL : countDetail(count),
    `${count} tips`,
  );
};

/**
 * The two ranking assertions both layers of pnpm check:02 make on a plan:
 * three rankings in SLOTS order, and every ranked id one of its slot's talks.
 */
export const rankingChecks = (plan: Plan): readonly CheckLine[] => {
  const { program } = loadProgram(undefined, () => undefined);
  const slotsInOrder = plan.rankings.map((r) => r.slot).join(',') === SLOTS.join(',');
  const idsBelong = plan.rankings.every((ranking) => {
    const slotIds = new Set(talksForSlot(program, ranking.slot).map((t) => t.id));
    return ranking.ranking.every((id) => slotIds.has(id));
  });
  return [
    assertion(
      'three rankings in slot order',
      slotsInOrder,
      `rankings are for ${plan.rankings.map((r) => r.slot).join(', ')}, expected ${SLOTS.join(', ')} (step 1)`,
    ),
    assertion(
      'every ranked id belongs to its slot',
      idsBelong,
      "a ranking names a talk from another slot; render the slot's talks into the prompt (step 1)",
    ),
  ];
};
