import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IdVariant } from '../backend/src/env.js';
import { LitellmClient, PARTICIPANT_MODELS } from '../backend/src/litellm.js';
import { pickCodeFor } from '../backend/src/pick-code.js';
import { adminFetch, litellmUrl, readAdminEnv } from './lib/admin-client.js';
import { flagNumber, parseArgs } from './lib/args.js';
import { keyRegistrationBody } from './lib/key-registration.js';
import { generatePseudonyms } from './lib/pseudonym.js';

/**
 * pnpm keys:create --count 45 --budget 2.2 --rpm 30
 * Creates one LiteLLM virtual key per pseudonym, registers the key hash in the
 * backend and writes infra/scripts/out/keys.csv and cards.html (gitignored).
 * ID_VARIANT from infra/.env decides whether the key is linked to its
 * pseudonym at once (slip) or later by /api/register (page); it must equal
 * the backend's ID_VARIANT. Slip cards also print the pick code the blind-pick
 * page asks for (HMAC of the id under WORKSHOP_ADMIN_TOKEN, see pick-code.ts),
 * so do not rotate the admin token after printing. On any failure the keys created so far are
 * deleted again: no partial cards.
 */
const DEFAULT_COUNT = 45;
const DEFAULT_BUDGET_USD = 2.2;
const DEFAULT_RPM = 30;
const OUT_DIR = resolve(import.meta.dirname, 'out');

/** Same parse as the backend, so a typo in infra/.env fails here and not at 11:00. */
const readIdVariant = (env: Record<string, string | undefined>): IdVariant => {
  const parsed = IdVariant.safeParse(env['ID_VARIANT'] ?? 'slip');
  if (!parsed.success) throw new Error(`ID_VARIANT must be slip or page, got ${env['ID_VARIANT']}`);
  return parsed.data;
};

const cardHtml = (
  cards: readonly { pseudonym: string; key: string; pickCode: string }[],
  backendUrl: string,
  variant: IdVariant,
): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Talk picker keys</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; }
  .card { border: 1px dashed #999; padding: 12px 14px; height: 120px; box-sizing: border-box; page-break-inside: avoid; }
  .id { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  code { font: 12px/1.3 ui-monospace, monospace; word-break: break-all; }
  small { color: #555; }
</style></head><body><div class="grid">
${cards.map((c) => `<div class="card">${variant === 'slip' ? `<p class="id">${c.pseudonym} <small>pick code ${c.pickCode}</small></p>` : ''}<code>${c.key}</code><br><small>Paste into .env as PROXY_API_KEY. Blind pick: ${backendUrl}/pick${variant === 'page' ? ' (the page gives you your id)' : ''}. Key dies at 13:00.</small></div>`).join('\n')}
</div></body></html>
`;

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const count = flagNumber(args, 'count', DEFAULT_COUNT);
  const budget = flagNumber(
    args,
    'budget',
    Number(process.env['KEY_BUDGET_USD'] ?? DEFAULT_BUDGET_USD),
  );
  const rpm = flagNumber(args, 'rpm', Number(process.env['KEY_RPM'] ?? DEFAULT_RPM));
  const env = readAdminEnv(process.env);
  if (!env.litellmMasterKey) throw new Error('LITELLM_MASTER_KEY must be set (infra/.env)');
  const variant = readIdVariant(process.env);

  const litellm = new LitellmClient({ baseUrl: litellmUrl(env), masterKey: env.litellmMasterKey });
  const existing = await adminFetch<{ pseudonyms: string[] }>(env, '/api/admin/keys');
  const pseudonyms = generatePseudonyms(count + existing.pseudonyms.length)
    .filter((p) => !existing.pseudonyms.includes(p))
    .slice(0, count);
  console.log(
    `creating ${pseudonyms.length} keys (budget $${budget}, ${rpm} rpm, id variant ${variant}) against ${env.backendUrl}`,
  );

  const created: { pseudonym: string; key: string }[] = [];
  try {
    for (const pseudonym of pseudonyms) {
      const key = await litellm.generateKey({
        alias: pseudonym,
        maxBudgetUsd: budget,
        rpmLimit: rpm,
        models: PARTICIPANT_MODELS,
      });
      await adminFetch(env, '/api/admin/keys', {
        method: 'POST',
        body: keyRegistrationBody(pseudonym, key, variant),
      });
      created.push({ pseudonym, key });
    }
  } catch (error) {
    console.error(
      `failed after ${created.length} keys: ${error instanceof Error ? error.message : error}`,
    );
    console.error('rolling back the keys created in this run');
    await litellm
      .deleteKeysByAlias(created.map((c) => c.pseudonym))
      .catch((e: unknown) => console.error('rollback failed:', e));
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, 'keys.csv'),
    ['pseudonym,key', ...created.map((c) => `${c.pseudonym},${c.key}`)].join('\n') + '\n',
  );
  const cards = created.map((c) => ({
    ...c,
    pickCode: pickCodeFor(env.adminToken, c.pseudonym),
  }));
  writeFileSync(resolve(OUT_DIR, 'cards.html'), cardHtml(cards, env.backendUrl, variant));
  console.log(
    `wrote ${OUT_DIR}/keys.csv and cards.html (${created.length} cards). Print cards.html, then shred keys.csv after the day.`,
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
