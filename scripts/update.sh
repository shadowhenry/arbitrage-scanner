#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# One-click update: pull latest code, rebuild images, apply migrations, restart services.
# Usage:
#   ./scripts/update.sh               # local stack update
#   ENV_FILE=.env.prod ./scripts/update.sh   # production stack update

ENV_FILE="${ENV_FILE:-}"
if [[ -n "$ENV_FILE" ]]; then
  # Production update path
  [[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
  compose=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)
else
  # Local update path
  compose=(docker compose -f docker-compose.yml)
fi

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null

echo "=== Pulling latest code ==="
if [[ -d "$ROOT_DIR/.git" ]]; then
  git pull --ff-only || { echo "git pull failed. Check for local changes with 'git status'." >&2; exit 1; }
else
  echo "No git repository detected — assuming source was uploaded directly (rsync/scp). Skipping git pull."
fi

echo "=== Rebuilding images ==="
"${compose[@]}" build --pull

echo "=== Applying migrations ==="
if [[ -n "$ENV_FILE" ]]; then
  "${compose[@]}" run --rm --no-deps api pnpm db:migrate
else
  "${compose[@]}" run --rm --no-deps api pnpm db:migrate
fi

echo "=== Rolling restart ==="
"${compose[@]}" up -d --wait --remove-orphans

echo ""
echo "Update complete. All services rebuilt and running."
