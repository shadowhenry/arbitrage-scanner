#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Local one-click startup: builds all images, starts every service, applies migrations.
# Usage:
#   ./scripts/up.sh                 # start everything with local compose
#   MOCK_FEED=0 ./scripts/up.sh     # disable API mock data

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null

compose=(docker compose -f docker-compose.yml)

if [[ ! -f .env ]]; then
  echo "Missing .env — copying from .env.example (development-safe defaults)."
  cp .env.example .env
fi

echo "Building application images..."
"${compose[@]}" build --pull

echo "Starting PostgreSQL and Redis..."
"${compose[@]}" up -d --wait postgres redis

echo "Applying database migrations..."
"${compose[@]}" run --rm --no-deps api pnpm db:migrate

echo "Starting application services (collector, scanner, simulator, api, dashboard)..."
"${compose[@]}" up -d --wait --remove-orphans

echo ""
echo "All services are up."
echo "  Dashboard (Vite dev): http://localhost:${DASHBOARD_PORT:-5173}"
echo "  API:                  http://localhost:${API_PORT:-3000}"
echo "  API health:           http://localhost:${API_PORT:-3000}/health"
echo ""
echo "View logs:"
echo "  docker compose -f docker-compose.yml logs -f --tail=100"
echo "Stop all:"
echo "  docker compose -f docker-compose.yml down"
