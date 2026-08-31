#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.prod}"
export ENV_FILE
BACKUP_ROOT="${BACKUP_DIR:-$ROOT_DIR/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DESTINATION="$BACKUP_ROOT/$STAMP"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
mkdir -p "$DESTINATION"
chmod 700 "$BACKUP_ROOT" "$DESTINATION"
compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "Backing up PostgreSQL..."
"${compose[@]}" exec -T postgres sh -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > "$DESTINATION/postgres.dump"

echo "Backing up Redis..."
"${compose[@]}" exec -T redis redis-cli BGSAVE >/dev/null
for _ in {1..30}; do
  redis_status="$("${compose[@]}" exec -T redis redis-cli INFO persistence | tr -d '\r')"
  if [[ "$redis_status" == *'rdb_bgsave_in_progress:0'* && "$redis_status" == *'rdb_last_bgsave_status:ok'* ]]; then
    break
  fi
  sleep 1
done
[[ "$redis_status" == *'rdb_bgsave_in_progress:0'* && "$redis_status" == *'rdb_last_bgsave_status:ok'* ]] || {
  echo "Redis BGSAVE did not complete successfully." >&2
  exit 1
}
"${compose[@]}" cp redis:/data/dump.rdb "$DESTINATION/redis.rdb"

[[ -s "$DESTINATION/postgres.dump" ]] || { echo "PostgreSQL backup is empty." >&2; exit 1; }
[[ -s "$DESTINATION/redis.rdb" ]] || { echo "Redis backup was not created." >&2; exit 1; }
(cd "$DESTINATION" && sha256sum postgres.dump redis.rdb > SHA256SUMS)
chmod 600 "$DESTINATION"/*
echo "Backup created at $DESTINATION"
