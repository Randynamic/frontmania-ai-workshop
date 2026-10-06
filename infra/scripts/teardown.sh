#!/usr/bin/env bash
# Tears the stack down and removes every volume (Postgres, MLflow artifacts, backend db, Caddy certs).
# Runs the data deletion first and refuses to continue unless it confirmed an empty stack.
set -euo pipefail
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"

echo "1/3 deleting workshop data (pnpm data:delete --execute)"
(cd "$REPO_DIR" && pnpm run data:delete --execute) || { echo "data deletion did not confirm an empty stack; teardown aborted"; exit 1; }

echo "2/3 this removes all containers and volumes of the talk-picker stack in $INFRA_DIR"
read -r -p "type DELETE to continue: " answer
[ "$answer" = "DELETE" ] || { echo "aborted"; exit 1; }

echo "3/3 docker compose down -v"
docker compose -f "$INFRA_DIR/docker-compose.yml" --profile vps --profile local down -v --remove-orphans
echo "stack removed at $(date -u +%FT%TZ)"
