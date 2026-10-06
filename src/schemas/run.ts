import { z } from 'zod';

/** The kinds of traced runs a participant registers with the backend (one per CLI). */
export const RUN_KINDS = ['profile', 'plan', 'agent', 'compare'] as const;
export const RunKind = z.enum(RUN_KINDS);
export type RunKind = z.infer<typeof RunKind>;
