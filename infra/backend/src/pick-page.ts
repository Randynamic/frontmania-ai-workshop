import type { IdVariant } from './env.js';

/**
 * Blind-pick page: one talk per afternoon slot, submitted before the demo so
 * the trainer's plan does not steer the choice. No participant key: the id
 * plus its pick code is the handle, and picks are final once saved. Two id
 * variants (repo-plan 4.1):
 * - slip: the participant types the id and pick code printed on the key slip.
 * - page: the page asks the backend for an id and pick code on first load and
 *   keeps both in localStorage; the participant copies the id into .env.local
 *   as TALK_PICKER_ID.
 */
const STORAGE_KEY = 'talk-picker-id';
const CODE_STORAGE_KEY = 'talk-picker-pick-code';

const idBlock = (variant: IdVariant): string =>
  variant === 'slip'
    ? `<label>Your id (from your card) <input type="text" name="participantId" required pattern="[a-z]+-[0-9]+" placeholder="otter-42"></label>
<label>Pick code (from your card) <input type="text" name="pickCode" required pattern="[0-9a-fA-F]{8}" autocomplete="off"></label>`
    : `<p class="id">Your id: <strong id="issued">...</strong><br><small>Copy it into <code>.env.local</code> as <code>TALK_PICKER_ID=&lt;id&gt;</code>; <code>pnpm run doctor</code> prints the same id.</small></p>
<input type="hidden" name="participantId" id="participantId">
<input type="hidden" name="pickCode" id="pickCode">`;

const issueScript = (variant: IdVariant): string =>
  variant === 'slip'
    ? ''
    : `const stored = localStorage.getItem('${STORAGE_KEY}');
const storedCode = localStorage.getItem('${CODE_STORAGE_KEY}');
const showId = (id, code) => { document.getElementById('issued').textContent = id; document.getElementById('participantId').value = id; document.getElementById('pickCode').value = code; };
if (stored && storedCode) showId(stored, storedCode);
else fetch('/api/ids', { method: 'POST' }).then(r => r.json()).then(({ participantId, pickCode }) => { if (!participantId || !pickCode) throw new Error('no id'); localStorage.setItem('${STORAGE_KEY}', participantId); localStorage.setItem('${CODE_STORAGE_KEY}', pickCode); showId(participantId, pickCode); }).catch(() => show('Could not get an id; tell the floater.', 'err'));`;

export const renderPickPage = (variant: IdVariant): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Talk picker: blind pick</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 42rem; padding: 1.5rem; color: #111; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 1.5rem; }
  label { display: block; padding: .35rem 0; } input[type=text] { font: inherit; padding: .4rem; width: 12rem; }
  button { font: inherit; padding: .6rem 1.2rem; margin-top: 1rem; }
  .ok { color: #0a6b2f; } .err { color: #a11; } small { color: #555; } .id strong { font-size: 1.4rem; }
</style>
</head>
<body>
<h1>Pick your afternoon, before the AI does</h1>
<p>Pick one talk per slot. Your picks are final once saved, stored under your id only and deleted today at 18:00.</p>
<form id="pick">
  ${idBlock(variant)}
  <div id="slots"><small>Loading programme...</small></div>
  <button type="submit">Save my picks</button>
  <p id="status"></p>
</form>
<script>
const slotsEl = document.getElementById('slots');
const statusEl = document.getElementById('status');
const show = (text, cls) => { statusEl.textContent = text; statusEl.className = cls; };
${issueScript(variant)}
fetch('/api/program').then(r => r.json()).then(program => {
  slotsEl.innerHTML = program.slots.map(slot => {
    const talks = program.talks.filter(t => t.slot === slot);
    return '<h2>' + slot + '</h2>' + talks.map(t =>
      '<label><input type="radio" name="slot:' + slot + '" value="' + t.id + '" required> ' + t.title + ' <small>(' + (t.speakers || []).join(', ') + ')</small></label>'
    ).join('');
  }).join('');
}).catch(() => show('Programme not available; tell the floater.', 'err'));
document.getElementById('pick').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const picks = {};
  for (const [key, value] of data.entries()) if (key.startsWith('slot:')) picks[key.slice(5)] = value;
  const body = { participantId: data.get('participantId'), pickCode: data.get('pickCode'), picks };
  const res = await fetch('/api/picks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  show(res.ok ? 'Saved. Your picks are final.' : 'Not saved: ' + ((await res.json().catch(() => ({}))).error || res.status), res.ok ? 'ok' : 'err');
});
</script>
</body>
</html>
`;
