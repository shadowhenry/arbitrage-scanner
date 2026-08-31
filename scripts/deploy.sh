#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.prod}"
export ENV_FILE
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.prod.example to .env.prod and configure it." >&2
  exit 1
fi

# Detect Docker Compose v2 plugin or legacy docker-compose.
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
else
  echo "Docker Compose plugin is required." >&2
  exit 1
fi

echo "Validating production configuration..."
"${compose[@]}" config --quiet

echo "Building application images..."
"${compose[@]}" build --pull

echo "Starting PostgreSQL and Redis..."
"${compose[@]}" up -d --wait postgres redis

echo "Applying database migrations..."
"${compose[@]}" run --rm --no-deps api pnpm db:migrate

echo "Starting application services..."
"${compose[@]}" up -d --wait --remove-orphans

"$ROOT_DIR/scripts/healthcheck.sh" "$ENV_FILE"
echo "Deployment complete."
