# Arbitrage Scanner

**Read-only, market-neutral arbitrage research platform.** Phase 1 continuously scans multiple exchanges and prediction markets, detects executable arbitrage opportunities, evaluates them under realistic costs (fees, slippage, latency, gas, inventory), and visualizes results in a real-time dashboard — **no real-money trading**.

> ⚠️ **Phase 1 is READ-ONLY.** This project never places real orders, never requests or stores private keys, and never uses authenticated trading APIs. Any live scanning and simulation is for research only.

---

## Features

- **7 venue adapters** with normalized data types and order-book reconstruction: Binance, Bybit, Hyperliquid, Jupiter, Raydium, Polymarket.
- **6 arbitrage strategies** (S1–S6), each with pure calculation functions and unit tests.
- **Executable-price pricing** — opportunities are priced from real order-book depth for the target size, not top-of-book quotes or last-traded prices.
- **Cost-aware shadow simulation** — gas (Solana), independent CEX/DEX failure probability, pre-funded inventory, and latency/price-drift models.
- **Real-time dashboard** — Vue 3 + Element Plus + ECharts; scanners push detected opportunities to the API, which broadcasts them over WebSocket.
- **Quality gates** — strict TypeScript, `pnpm lint` / `typecheck` / `test` must pass.

## Dashboard

The research dashboard gives a live, read-only view of detected opportunities, simulated P&L, net-edge leaders, and capital allocation. Scanners push opportunities to the API, which broadcasts them over WebSocket so the UI updates in real time.

![Overview](./docs/assets/dashboard-1.png)
*Overview — research command center: opportunity counts, simulated profit, best opportunity, net-edge leaders, and capital allocation.*

![Opportunities](./docs/assets/dashboard-2.png)
*Opportunities — executable two-leg combinations across all strategies (S1–S6), filterable by asset, venue, strategy, and minimum net edge.*

## Supported venues

| Type | Venues |
|------|--------|
| CEX Spot | Binance, Bybit |
| Perpetual | Binance Futures, Bybit Linear, Hyperliquid |
| Solana DEX | Jupiter, Raydium |
| Prediction | Polymarket |

## Strategies

| ID | Strategy | Scanner | Status |
|----|----------|---------|--------|
| S1 | Spot/Perp Basis | `scan:cex` / `scan:basis` | ✅ Implemented |
| S2 | Perp/Perp Funding Arbitrage | `scan:cex` / `scan:funding` | ✅ Implemented |
| S3 | CEX/CEX Spot Arbitrage | `scan:cex` | ✅ Implemented |
| S4 | CEX/DEX Arbitrage | `scan:cex-dex` | ✅ Implemented |
| S5 | DEX/DEX Arbitrage | `scan:dex-dex` | ✅ Implemented |
| S6 | Polymarket Binary Arbitrage | `scan:polymarket` | ✅ Implemented |

S1–S5 are handled by a universal arbitrage-graph engine that builds nodes from order books or routing curves and auto-detects the strategy type; S6 is a binary complete-set engine.

## Architecture

A pnpm monorepo with independently buildable apps and shared packages. Dependencies point inward toward stable domain contracts: venue adapters must not contain strategy logic, and strategies consume only normalized market data.

```text
apps/
  collector/    public market-data ingestion workers
  scanner/      strategy evaluation and opportunity generation workers
  simulator/    fill, fee, latency, and slippage simulation
  api/          Fastify read API + WebSocket real-time push + mock feed
  dashboard/    Vue 3 research dashboard (7 pages)

packages/
  core/         normalized domain types and cross-cutting primitives
  venues/       7 venue adapters (normalized types + order book reconstruction)
  strategies/   strategy contracts and pure opportunity calculations
  risk/         opportunity validation + 4 shadow-simulation cost models
  execution/    Phase 1 read-only execution boundary
  database/     PostgreSQL connection, schema, and migrations
```

```mermaid
flowchart LR
    subgraph Venues
        BIN[Binance] --> V[venues adapters]
        BYB[Bybit] --> V
        HYP[Hyperliquid] --> V
        JUP[Jupiter] --> V
        RAY[Raydium] --> V
        POL[Polymarket] --> V
    end
    V --> CORE[(normalized market data)]
    CORE --> SCAN[scanner / strategies]
    SCAN --> RISK[risk policies]
    RISK --> PUSH[push /api/opportunities]
    PUSH --> API[api + WebSocket /ws]
    API --> DASH[dashboard]
    SCAN --> SIM[simulator]
    SIM --> DB[(PostgreSQL)]
    API --> DB
```

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22, TypeScript (strict) |
| Package manager | pnpm workspace |
| Data stores | PostgreSQL, Redis |
| Queues | BullMQ |
| HTTP / WS | Fastify |
| Frontend | Vue 3, Element Plus, ECharts |
| Delivery | Docker Compose |

---

## Quick start (local development)

### Prerequisites

- Node.js 22+
- pnpm (`corepack enable` or `npm i -g pnpm@10`)
- PostgreSQL 15+ *(optional — mock mode works without it)*

### 1. Mock mode (no database, no exchange access)

```bash
pnpm install

# Start the API with a simulated data feed (port 3000)
pnpm api:dev

# In another terminal, start the Dashboard (port 5173, auto-proxies to the API)
pnpm dashboard:dev
```

Open http://localhost:5173. The dashboard connects to the API via WebSocket and updates live (mock feed refreshes every 3 s).

### 2. Run real scanners

Each scanner runs as an independent process and reads public venue feeds (no API key needed for public CEX data):

```bash
# S1 + S2 + S3 (CEX: Binance, Bybit, Hyperliquid)
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

Detected opportunities are pushed to the API (`POST /api/opportunities`), broadcast over `/ws`, and shown in the dashboard. Set `MOCK_FEED=0` so the dashboard shows only real scanner data.

> **Geo note:** Binance and Bybit block IPs in certain regions (e.g. the US). If your host is in a restricted region, those venue feeds will fail — run the CEX scanners from a supported region, or keep the DEX/Polymarket scanners (`dex-dex`, `polymarket`) which are not geo-restricted.

### 3. Run shadow simulation

```bash
# Synthetic 30-day replay (no database needed)
SYNTHETIC=1 pnpm --filter @arbitrage-scanner/simulator replay:synthetic

# Database replay (requires historical data in PostgreSQL)
DATABASE_URL=postgresql://user:pass@localhost:5432/arbitrage \
  pnpm --filter @arbitrage-scanner/simulator replay
```

Reports are written to `apps/simulator/reports/`.

---

## Production deployment (Docker one-click)

The production stack runs on one Ubuntu server with Docker Engine + Compose v2. All six services are managed by `docker-compose.prod.yml`; the `api` container publishes **a single host port** (default **8080**) that serves the Dashboard SPA, the REST API, and the WebSocket together. Your own Nginx (domain + TLS operator-managed) reverse-proxies to that port.

```
Internet → Nginx (crypto.yourdomain.com, TLS) → 127.0.0.1:8080 (api container)
                                                    ├── Dashboard SPA (/)
                                                    ├── REST API (/api)
                                                    └── WebSocket (/ws)
```

### 1. Server prerequisites

- DNS A/AAAA record for your domain pointing at the server; inbound TCP 80/443 allowed.
- Docker Engine with the Compose plugin installed.
- *(Optional)* An existing Redis on the host is left untouched — the compose Redis publishes **6380** to avoid clashing with 6379.

### 2. Configure environment

```bash
cp .env.prod.example .env.prod
$EDITOR .env.prod
```

At minimum set a strong `POSTGRES_PASSWORD` (and `SOLANA_RPC_API_KEY` / `JUPITER_API_KEY` if you use the DEX scanners). **Never commit `.env.prod`.** Phase 1 needs no exchange private keys.

### 3. Deploy

```bash
./scripts/deploy.sh
```

The script builds the application images (the API image includes the Dashboard build), starts PostgreSQL and Redis, runs database migrations, then starts and waits for all six services.

### 4. Nginx reverse proxy (single port)

Point your Nginx at `http://127.0.0.1:8080`. The dashboard derives its WebSocket URL from `location.host`, so no hard-coded WS URL is needed. A minimal server block:

```nginx
server {
    listen 80;
    server_name crypto.yourdomain.com;

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

Add your TLS certificate (`listen 443 ssl; ...`) in the usual way — the API already trusts `X-Forwarded-*` headers.

### 5. Operations

```bash
# Health status of all six services
./scripts/healthcheck.sh

# Backup PostgreSQL + Redis (timestamped, with SHA-256 checksums)
./scripts/backup.sh

# Deploy a newer build without git
./scripts/update.sh

# Follow logs
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200
```

| Host port | Service | Notes |
|-----------|---------|-------|
| 8080 | api | Dashboard SPA + REST + WebSocket |
| 6380 | redis | Compose-managed; avoids an existing host Redis on 6379 |
| *(none)* | postgres | Internal-only by default; set `POSTGRES_PUBLISH_PORT` if you need host access |

> The project requires **PostgreSQL** (JSONB, identity columns, advisory locks) — an existing MySQL instance cannot be used; the compose file starts its own `postgres` container.

---

## Key environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_PUBLISH_PORT` | `8080` | Host port published by the api container |
| `MOCK_FEED` | `1` (dev) / `0` (prod) | `0` disables mock data so only real scanner data is shown |
| `POSTGRES_PASSWORD` | — | PostgreSQL password (set a strong random value) |
| `POSTGRES_PUBLISH_PORT` | *(empty)* | Optional host port for PostgreSQL |
| `REDIS_PUBLISH_PORT` | `6380` | Host port for the compose-managed Redis |
| `JUPITER_API_KEY` | *(none)* | Jupiter API key for higher rate limits |
| `SOLANA_RPC_URL` / `SOLANA_RPC_API_KEY` | *(none)* | Helius Solana RPC for network-state collection |
| `VITE_WS_URL` | *(auto)* | Override dashboard WebSocket URL (usually leave empty) |
| `API_URL` | `http://localhost:3000` | Scanner → API push target (`http://api:3000` in Docker) |

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
```

All changes must pass all three. Strategy modules require unit tests covering profitable, unprofitable, insufficient-depth, stale-data, fee, and rounding cases.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Full architecture, dependency rules, implementation status
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Local development + production deployment details
- [SHADOW_SIMULATION.md](./SHADOW_SIMULATION.md) — 30-day shadow simulation guide

## Safety

Phase 1 is **read-only**. No real trading, no private keys, no authenticated trading APIs. Secrets live only in environment variables and are never logged. Real-money execution is deliberately out of scope until a 30-day shadow simulation demonstrates stable positive expected return under realistic costs.
