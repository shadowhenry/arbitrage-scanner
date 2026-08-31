# Single-server production deployment

This deployment targets one Ubuntu server with Docker Engine and Docker Compose v2. The `api` container publishes a single host port and serves the Dashboard SPA, REST, and WebSocket together; your existing Nginx (domain/TLS is operator-managed) reverse-proxies to that port. PostgreSQL and Redis are attached to a private Docker network; only the API port (and optionally Redis/Postgres) are published on the host.

## Local development

### Prerequisites

- Node.js 22+
- pnpm 11+
- PostgreSQL 15+ (optional, for real data; mock mode works without it)

### Quick start (mock data, no database)

```bash
# 1. Install dependencies
pnpm install

# 2. Start API (includes mock data feed, port 3000)
pnpm api:dev

# 3. In another terminal, start Dashboard (port 5173, auto-proxies to API)
pnpm dashboard:dev
```

Open http://localhost:5173. The dashboard shows "Live data" when connected to the API WebSocket; the mock feed updates every 3 seconds.

### Start individual scanners

Each scanner runs as an independent process. Scanners detect opportunities from live venue feeds (no API key required for public data):

```bash
# S1+S2+S3 (CEX: Binance, Bybit, Hyperliquid)
pnpm scan:cex

# S4 (CEX-DEX: Binance Spot ↔ Jupiter)
pnpm scan:cex-dex

# S5 (DEX-DEX: Jupiter ↔ Raydium)
pnpm scan:dex-dex

# S6 (Polymarket binary)
pnpm scan:polymarket

# All scanners at once
pnpm --filter @arbitrage-scanner/scanner start:prod
```

### Run shadow simulation

```bash
# Synthetic 30-day replay (no database needed)
SYNTHETIC=1 pnpm --filter @arbitrage-scanner/simulator replay:synthetic

# Database replay (requires historical data in PostgreSQL)
DATABASE_URL=postgresql://user:pass@localhost:5432/arbitrage \
  pnpm --filter @arbitrage-scanner/simulator replay
```

Reports are written to `apps/simulator/reports/`.

### Key environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_PORT` | `3000` | API listen port |
| `MOCK_FEED` | `1` | Set to `0` to disable mock data when real scanners are connected |
| `MOCK_FEED_INTERVAL_MS` | `3000` | Mock data update interval |
| `VITE_WS_URL` | (auto) | Override Dashboard WebSocket URL (e.g. `ws://localhost:3000/ws`) |
| `API_TARGET` | `http://localhost:3000` | Dashboard Vite proxy target |
| `API_URL` | `http://localhost:3000` | Scanner → API push target (`http://api:3000` in Docker) |
| `JUPITER_API_KEY` | (none) | Jupiter API key for higher rate limits |
| `SOLANA_RPC_URL` | (none) | Solana RPC for network state collection |

### How scanner data reaches the Dashboard

Each scanner (`cex`, `cex-dex`, `dex-dex`, `polymarket`) converts detected opportunities with `toOpportunityRow`/`toBinaryOpportunityRow` (`apps/scanner/src/push.ts`) and POSTs them to the API's `/api/opportunities` (single object or batch array are both accepted). The API stores rows in memory, broadcasts them over the WebSocket at `/ws`, and exposes them via `GET /api/dashboard`. Failures to reach the API are logged but never block the scan loop, so scanners run standalone (e.g. locally) without a Dashboard too.

Set `MOCK_FEED=0` so the Dashboard shows only scanner data. When running scanners locally and the API with `MOCK_FEED=1`, both mock and real rows coexist.

### Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
```

---

## Server prerequisites

- Point the configured domain's DNS A/AAAA record at the server.
- Allow inbound TCP 80 and 443 (and UDP 443 for HTTP/3 if you use it).
- Install Docker Engine with the Compose plugin.
- Copy `.env.prod.example` to `.env.prod`; set a strong `POSTGRES_PASSWORD`.

Never commit `.env.prod`. Phase 1 remains read-only and needs no exchange private keys.

### MySQL / Redis on the host

The project's database is **PostgreSQL only** (the `pg` driver plus PostgreSQL-specific SQL: `JSONB`, `GENERATED ALWAYS AS IDENTITY`, `UNIQUE NULLS NOT DISTINCT`, `pg_advisory_xact_lock`). An existing **MySQL instance cannot be used** — the compose file starts its own `postgres` container. Set `POSTGRES_PUBLISH_PORT` only if you need host access (e.g. `5433` to avoid clashing with an existing PostgreSQL).

**Redis** is compose-managed and self-contained. It publishes host port **6380** by default (`REDIS_PUBLISH_PORT`) so it never clashes with an existing Redis on 6379. App containers talk to the internal `redis:6379`; they do not touch the host's Redis.

### Single-port architecture (Nginx reverse proxy)

There is no Caddy. The `api` container serves **everything from one port** (host port `API_PUBLISH_PORT`, default **8080**):

- the Dashboard SPA (static build copied into the image at Docker build time),
- REST under `/api`,
- the real-time WebSocket at `/ws`.

The Dashboard resolves its WebSocket URL from `location.host` automatically, so the Nginx config needs no hard-coded WS URL. Point your Nginx (with your own domain/TLS) at `http://127.0.0.1:8080`. A minimal server block:

```nginx
server {
    listen 80;
    server_name arbitrage.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket upgrade (required for live dashboard updates)
    location /ws {
        proxy_pass http://127.0.0.1:8080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

Add your TLS certificate (`listen 443 ssl; ...`) in the usual way. The API already trusts `X-Forwarded-*` headers (`trustProxy: true`).

## Deploy

```bash
cp .env.prod.example .env.prod
$EDITOR .env.prod
./scripts/deploy.sh
```

The deployment builds the application images (API image includes the Dashboard build), starts the data stores, runs PostgreSQL migrations, then starts and waits for all six services. PostgreSQL data and Redis AOF data live in named Docker volumes.

## Operations

```bash
./scripts/healthcheck.sh
./scripts/backup.sh
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200
```

Backups are written to timestamped directories under `backups/` with SHA-256 checksums. Copy that directory to a separate host or object store; a same-server backup does not protect against disk failure. Test restoration before relying on it.

Docker rotates each container's JSON logs at 10 MB and retains five files. Resource limits are conservative defaults and should be tuned using observed workload and server capacity.

## Restore outline

Stop application services before restoring. Restore PostgreSQL with `pg_restore --clean --if-exists` into the configured database. Restore Redis only while Redis is stopped by replacing its persisted data from `redis.rdb`. Take a fresh backup first and rehearse the exact procedure on a non-production host.

