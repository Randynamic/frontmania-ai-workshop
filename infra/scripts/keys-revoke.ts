import { LitellmClient } from '../backend/src/litellm.js';
import { adminFetch, fetchStats, litellmUrl, readAdminEnv } from './lib/admin-client.js';
import { parseArgs } from './lib/args.js';

/**
 * pnpm keys:revoke [--dry-run]
 * 13:00 on the day: deletes every participant key in LiteLLM (by alias) and
 * marks them revoked in the backend so /api/auth and the gateway refuse them.
 */
const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const isDryRun = args.flags['dry-run'] === true;
  const env = readAdminEnv(process.env);
  const { pseudonyms } = await adminFetch<{ pseudonyms: string[] }>(env, '/api/admin/keys');
  const before = await fetchStats(env);
  console.log(
    `keys: ${before.keys} total, ${before.keysRevoked} already revoked, ${pseudonyms.length} aliases known`,
  );
  if (isDryRun) {
    console.log('dry run: nothing revoked');
    return;
  }
  if (!env.litellmMasterKey) throw new Error('LITELLM_MASTER_KEY must be set (infra/.env)');
  const litellm = new LitellmClient({ baseUrl: litellmUrl(env), masterKey: env.litellmMasterKey });
  await litellm.deleteKeysByAlias(pseudonyms);
  const { revoked } = await adminFetch<{ revoked: number }>(env, '/api/admin/keys/revoke-all', {
    method: 'POST',
  });
  const after = await fetchStats(env);
  console.log(
    `litellm: ${pseudonyms.length} aliases deleted; backend: ${revoked} newly revoked; ${after.keysRevoked}/${after.keys} revoked now`,
  );
  process.exit(after.keysRevoked === after.keys ? 0 : 1);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
