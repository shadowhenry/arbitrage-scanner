#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ENV_FILE:-$ROOT_DIR/.env.prod}}"
export ENV_FILE
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
services=(postgres redis collector scanner simulator api)
failed=0

for service in "${services[@]}"; do
  container_id="$("${compose[@]}" ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    echo "FAIL $service: container is not running"
    failed=1
    continue
  fi
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  if [[ "$status" == "healthy" || "$status" == "running" ]]; then
    echo "OK   $service: $status"
  else
    echo "FAIL $service: $status"
    failed=1
  fi
done

(( failed == 0 )) || exit 1
echo "All production services are healthy."
