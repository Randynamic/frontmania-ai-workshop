/** Trainer-side client for the backend admin API and the LiteLLM admin API through the gateway. */
export interface AdminEnv {
  readonly backendUrl: string;
  readonly adminToken: string;
  readonly litellmMasterKey: string;
}

export const readAdminEnv = (env: Record<string, string | undefined>): AdminEnv => {
  const backendUrl = env['WORKSHOP_BACKEND_URL'];
  const adminToken = env['WORKSHOP_ADMIN_TOKEN'];
  const litellmMasterKey = env['LITELLM_MASTER_KEY'] ?? '';
  if (!backendUrl || !adminToken) {
    throw new Error('WORKSHOP_BACKEND_URL and WORKSHOP_ADMIN_TOKEN must be set (infra/.env)');
  }
  return { backendUrl: backendUrl.replace(/\/$/, ''), adminToken, litellmMasterKey };
};

const TIMEOUT_MS = 15_000;

export const adminFetch = async <T>(
  env: AdminEnv,
  route: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> => {
  const response = await fetch(`${env.backendUrl}${route}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${env.adminToken}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${route} -> ${response.status}: ${text.slice(0, 200)}`,
    );
  return (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T;
};

export interface AdminStats {
  readonly keys: number;
  readonly keysRevoked: number;
  readonly picks: number;
  readonly profiles: number;
  readonly runs: number;
  readonly feedback: number;
  readonly feedbackAttached: number;
}

export const fetchStats = (env: AdminEnv): Promise<AdminStats> =>
  adminFetch<AdminStats>(env, '/api/admin/stats');

/** LiteLLM admin routes are reachable through the gateway at /proxy/* with the master key. */
export const litellmUrl = (env: AdminEnv): string => `${env.backendUrl}/proxy`;
