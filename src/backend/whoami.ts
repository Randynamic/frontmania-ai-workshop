import { z } from 'zod';
import { backendRequest, type BackendConfig } from './client.js';

/** GET /api/whoami: the pseudonym the backend linked to this key (see scripts/doctor for the two hand-out variants). */
export const WhoamiResponse = z.object({ ok: z.literal(true), participantId: z.string().min(1) });
export type WhoamiResponse = z.infer<typeof WhoamiResponse>;

export const fetchParticipantId = async (config: BackendConfig): Promise<string> => {
  const response = await backendRequest(config, '/api/whoami', { schema: WhoamiResponse });
  return response.participantId;
};
