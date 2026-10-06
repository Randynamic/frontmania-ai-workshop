# Workshop infrastructure

Five containers, one command. Everything a participant or trainer depends on
during the session runs here: model proxy, tracing backend, prompt registry,
blind-pick page, feedback store. The Dutch day-of runbook is in
`../../03-operations/infra-runbook.md` (outside this repo, in the workshop package).

| Service  | Image                                    | Purpose                                                                                                             | Health                    |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| postgres | `postgres:17-alpine`                     | databases `mlflow` and `litellm`                                                                                    | `pg_isready`              |
| mlflow   | `mlflow/Dockerfile` (v3.16.1 + psycopg2) | traces via OTLP `/v1/traces`, prompt registry, UI                                                                   | `GET /health`             |
| litellm  | `litellm/litellm:v1.102.1`               | OpenAI-compatible proxy in front of Google Vertex AI (Gemini), one virtual key per participant, message logging off | `GET /health/liveliness`  |
| backend  | `backend/Dockerfile` (Hono, this repo)   | `/pick`, picks, profiles, runs, feedback to MLflow assessments, prompt-by-alias, trace read, admin                  | `GET /api/health`         |
| caddy    | `caddy:2.11.4-alpine`                    | TLS, routing, `forward_auth` for trace ingestion, basic auth for the MLflow UI                                      | through `GET /api/health` |

## Up

```sh
cd infra
cp .env.example .env            # fill every value; COMPOSE_PROFILES=vps or local
docker compose up -d --build    # first time: builds mlflow and backend images
docker compose ps               # every service "healthy"
```

Then, from the repo root with `infra/.env` filled in:

```sh
uv run --project optimize optimize/seed_prompts.py   # final branch: creates experiment frontmania-2026 and the three prompts
# paste the experiment id into infra/.env as MLFLOW_EXPERIMENT_ID, then: docker compose up -d
pnpm keys:create --count 45     # writes infra/scripts/out/{keys.csv,cards.html}; print cards.html
pnpm smoke                      # with one participant key in the root .env: doctor, backend routes, every participant script on this branch
```

## Local parity

`COMPOSE_PROFILES=local docker compose up -d --build` starts the same five
containers without TLS: gateway on `http://localhost:8080`, MLflow UI on
`http://localhost:8081`. Participant `.env` for the local stack:

```
PROXY_BASE_URL=http://localhost:8080/proxy/v1
WORKSHOP_BACKEND_URL=http://localhost:8080
MLFLOW_OTLP_ENDPOINT=http://localhost:8080/otel/v1/traces
```

## Routes through the gateway

| Path                                       | Goes to                                                                                      | Auth                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/proxy/*`                                 | litellm (prefix stripped)                                                                    | participant key (LiteLLM virtual key)       |
| `POST /otel/v1/traces`, `GET /otel/health` | backend `GET /api/auth`, then mlflow (prefix stripped, key removed, experiment header added) | participant key                             |
| any other `/otel/*`                        | 404 at the gateway; the MLflow REST API is trainer-only (`pnpm smoke` asserts this)          | none                                        |
| `/pick`, `/api/program`, `/api/health`     | backend                                                                                      | none                                        |
| `POST /api/picks`                          | backend; write-once per id (409 on a second submit)                                          | pick code (card or page), per-id rate limit |
| `/api/*`                                   | backend                                                                                      | participant key                             |
| `/api/admin/*`                             | backend                                                                                      | `WORKSHOP_ADMIN_TOKEN`                      |
| `https://mlflow.<PUBLIC_HOST>`             | mlflow UI                                                                                    | basic auth (trainers)                       |

## After the session

```sh
pnpm keys:revoke                 # 13:00: LiteLLM keys deleted, backend marks them revoked
pnpm data:delete                 # dry run (default, same as --dry-run), prints counts
pnpm data:delete --execute       # 18:00: traces + rows gone, exits 0 only when counts are 0
infra/scripts/teardown.sh        # runs the deletion again, then docker compose down -v
```

## Verified 26 Sep 2026 against a local `ghcr.io/mlflow/mlflow:v3.16.1`

One Mastra 1.71.0 trace (mock model, real `OtelExporter`, `http/protobuf`,
header `x-mlflow-experiment-id`) was ingested and read back; the observed
JSON is committed as `backend/src/fixtures/mlflow-3.16.1-trace.json` and
`mlflow-3.16.1-prompt-alias.json`, and `trace-view.test.ts` runs on it.
Confirmed: trace id `tr-` + OTel hex; `GET /api/3.0/mlflow/traces/get?trace_id=`
(POST answers 405); `POST .../traces/search` with `locations`;
`POST .../traces/{id}/assessments` with `{ assessment: { feedback | expectation } }`
lands in `trace_info.assessments`; `POST .../delete-traces`; the two
registered-model GETs for the prompt alias with tag `mlflow.prompt.text`.
The masked input reached MLflow as `[cv:sha256:...]`. MLflow has no
`/v1/logs`, so the exporter's logs signal is off.

## Codespaces URL

The root `README.md` links `https://codespaces.new/Randynamic/frontmania-ai-workshop?quickstart=1`
(default branch `00-setup`, so a new Codespace starts there). The same URL goes on
slide 1. The server runs at `https://34-13-188-3.sslip.io` (GCE VM `talk-picker`, project
`frontmaniaworkshop`, europe-west4) with the trainer UI at `https://mlflow.34-13-188-3.sslip.io`.

Create the repo as **private** and keep it private until the "Publication
decision" table in `data/README.md` (runbook D-1 step 11) records the
organiser's consent: `data/` carries real speaker names and abstracts.
Codespaces prebuilds work on a private repo of the organisation.

Set Organisation settings > Codespaces > General > Codespace ownership to
**User ownership** before the day (verified in the GitHub docs, 26 Sep 2026):
each participant's Codespace, and any CV file in it, is then owned and paid
for by their own account and the organisation has no access to it. If the
organisation must pay (Organisation ownership), add a Codespaces policy with
a Retention period of 0 days for this repo and delete every remaining
Codespace at 18:00 with `gh api /orgs/<org>/codespaces` and
`gh api -X DELETE /orgs/<org>/members/<user>/codespaces/<name>` (runbook,
after-the-session steps). The README tells participants to delete their own
Codespace before they leave.

## Still to verify at the D-1 spike (needs the VPS stack)

- LiteLLM healthcheck: `docker compose ps` shows `litellm` as `healthy` within
  its `start_period`. The image has no `curl` or `wget` (checked 26 Sep 2026
  on `v1.102.1`), so the check is a `python3 -c urllib` one-liner, the same
  shape as upstream's compose. If it stays `starting`, `backend` and `caddy`
  never come up: that is the first thing to look at.
- LiteLLM: `os.environ/` substitution for `model` in `litellm/config.yaml`
  (documented for `api_key` and `master_key`); `/key/delete` accepting
  `key_aliases`; spend shown in USD (`KEY_BUDGET_USD`).
- Caddy: `forward_auth` passes the `Authorization` header to `/api/auth`, and
  the `x-mlflow-experiment-id` it adds lands traces in `frontmania-2026`.
  The `/otel` allow-list (only `POST /otel/v1/traces`, `GET /otel/health`,
  everything else 404) was checked on 26 Sep 2026 with `caddy:2.11.4-alpine`
  and stub upstreams; `pnpm smoke` re-asserts the 404 against the real stack.
- `pnpm ingest` in live mode (real embedding dimension) before the index is
  committed; `pnpm run doctor` fails on `data` while the manifest says `mock`
  and `MODEL_MODE=live`.
