# Arbitrage Scanner Architecture

## 1. Scope and phase

Arbitrage Scanner is a read-only, market-neutral arbitrage research platform. Phase 1 collects public market data, normalizes it, detects candidate opportunities, evaluates risk, simulates execution, and exposes results for research.

Real-money trading, private-key custody, authenticated trading APIs, and venue-specific implementations are out of scope. The `execution` package exists as a safety boundary and deliberately rejects real trading.

## 2. Monorepo layout

The repository is a pnpm workspace with independently buildable applications and shared packages.

```text
apps/
  collector/    public market-data ingestion workers
  scanner/      strategy evaluation and opportunity generation workers
  simulator/    fill, fee, latency, and slippage simulation
  api/          Fastify read API and health endpoint
  dashboard/    Vue 3 research dashboard

packages/
  core/         normalized domain types and cross-cutting primitives
  venues/       venue-adapter contracts and, later, venue implementations
  strategies/   strategy contracts and pure opportunity calculations
  risk/         opportunity validation and exposure policies
  execution/    Phase 1 read-only execution boundary
  database/     PostgreSQL connection and persistence boundary
```

## 3. Dependency rules

Dependencies point inward toward stable domain contracts:

```text
venue APIs (future)
       |
       v
   venues ---> core <--- strategies
       |                    |
       v                    v
  collector              scanner ---> risk
       |                    |
       +---- normalized ----+
             market data
                    |
                    v
                simulator ---> execution (read-only)
                    |
                    v
                 database <--- api <--- dashboard
```

The following constraints are mandatory:

- `core` owns normalized market identifiers, order books, price levels, and common health types.
- `venues` translates external payloads into `core` types. It must not import strategy logic.
- `strategies` consumes only normalized data and must not depend on venue SDKs or raw payloads.
- Opportunity calculations use executable depth for the requested size, fees, and other costs. A top-of-book quote or last trade is not sufficient evidence of executable profit.
- `risk` evaluates strategy output without performing I/O or placing orders.
- `execution` cannot place real orders in Phase 1.
- `database` owns PostgreSQL connectivity; applications should not create ad hoc database clients.

## 4. Runtime data flow

1. `collector` workers will read public venue feeds through adapters in `venues`.
2. Adapters validate and convert venue payloads to normalized `core` types.
3. Collectors will publish normalized snapshots and events through BullMQ/Redis and persist research history in PostgreSQL.
4. `scanner` workers consume normalized data, run strategies, then apply risk policies.
5. `simulator` estimates executable fills, fees, slippage, funding, latency, and failure scenarios without submitting orders.
6. `api` reads computed state and exposes read-only endpoints.
7. `dashboard` presents health, venue status, opportunities, simulations, and historical analysis.

Queue names, database schemas, event envelopes, and retention policies will be designed before venue integrations begin.

## 5. Infrastructure

Docker Compose provides local PostgreSQL and Redis services. Both have container health checks and persistent named volumes. Configuration is read from environment variables; `.env.example` contains development-safe placeholders and `.env` is ignored by Git.

The initial 30-day research experiment uses plain PostgreSQL rather than TimescaleDB. Time-series observations are append-only and indexed by timestamp and parent entity. This keeps local operations simple while the workload is bounded; TimescaleDB should only be reconsidered after measured ingestion volume, retention cost, or aggregate-query latency justifies it. The schema and migration rationale live in `packages/database/README.md`.

Application health checks are intentionally shallow at this stage:

- `GET /health` confirms that the Fastify process can serve requests.
- Collector, scanner, and simulator expose deterministic process-level health functions.
- PostgreSQL and Redis use native Compose health checks.

Dependency-aware readiness checks will be added when the applications begin using those services.

## 6. TypeScript and package conventions

- Node.js applications and shared packages use ESM and NodeNext resolution.
- The dashboard uses Vite's bundler resolution.
- Strict TypeScript, unchecked-index protection, exact optional properties, unused-symbol checks, and isolated modules are enabled centrally.
- Shared packages export source during early development so tests and type checking require no publish step. Production packaging can switch exports to compiled artifacts once deployment targets are defined.
- Tests use Vitest and live next to the source they verify.

## 7. Quality gates

From the repository root, every change must pass:

```text
pnpm lint
pnpm typecheck
pnpm test
```

Strategy implementations require unit tests for profitable, unprofitable, insufficient-depth, stale-data, fee, and rounding cases. Venue implementations require normalization contract tests and recorded public-data fixtures; no secrets may appear in fixtures or logs.

## 8. Implementation status

As of the current development phase, the following modules are implemented:

### Venue adapters (`packages/venues/`)

All seven supported venues have working adapters with normalized types, order book reconstruction, and unit tests:

| Venue | Module | Market types |
|-------|--------|-------------|
| Binance | `binance/` | Spot (`spot.ts`), USDⓈ-M Futures (`futures.ts`) |
| Bybit | `bybit/` | Spot (`spot.ts`), Linear Perpetual (`linear.ts`) |
| Hyperliquid | `hyperliquid/` | Perpetual (`adapter.ts`) |
| Jupiter | `jupiter/` | Routing quotes (`client.ts`) |
| Raydium | `raydium/` | Routing quotes (`client.ts`) |
| Polymarket | `polymarket/` | Binary prediction markets (`client.ts`) |

### Strategies (`packages/strategies/`)

All six strategies have pure calculation functions with unit tests:

| ID | Strategy | Module | Function |
|----|----------|--------|----------|
| S1 | Spot/Perp Basis | `basis-arbitrage.ts` | `scanSpotPerpBasisArbitrage()` |
| S2 | Perp/Perp Funding | `funding-arbitrage.ts` | `scanPerpFundingArbitrage()` |
| S3 | CEX/CEX Spot | `arbitrage-graph.ts` | `scanArbitrageGraph()` (auto-detects S3) |
| S4 | CEX/DEX | `arbitrage-graph.ts` | `scanArbitrageGraph()` (auto-detects S4) |
| S5 | DEX/DEX | `arbitrage-graph.ts` | `scanArbitrageGraph()` (auto-detects S5) |
| S6 | Polymarket Binary | `binary-complete-set.ts` | `scanBinaryCompleteSetArbitrage()` |

The universal `arbitrage-graph` engine handles S1–S5 by building graph nodes from order books or routing curves and detecting strategy type from node properties (market type + venue kind).

### Scanner applications (`apps/scanner/`)

| Script | Strategies | Data sources |
|--------|-----------|-------------|
| `cex.ts` | S1, S2, S3 | Binance Spot/Futures, Bybit Spot/Linear, Hyperliquid |
| `cex-dex.ts` | S4 | Binance Spot + Jupiter (with gas cost deduction) |
| `dex-dex.ts` | S5 | Jupiter + Raydium |
| `polymarket.ts` | S6 | Polymarket Yes/No order books |
| `funding.ts` | S2 (standalone) | Binance Futures, Bybit Linear, Hyperliquid |
| `basis.ts` | S1 (standalone) | Binance/Bybit Spot + 3 perp venues |
| `production.ts` | All | Starts all scanner modules |

### Simulation cost models (`packages/risk/src/sim-*.ts`)

Four cost models for shadow simulation:

| Model | File | Purpose |
|-------|------|---------|
| Gas | `sim-gas-model.ts` | Solana base fee + priority fee calculation |
| Failure | `sim-failure-model.ts` | Independent CEX/DEX failure sampling + unwind costs |
| Inventory | `sim-inventory.ts` | Pre-funded inventory state and execution checks |
| Latency | `sim-latency-model.ts` | Execution latency + normal-distribution price drift |

### Replay engine (`apps/simulator/`)

- `replay-engine.ts` — Event-driven historical replay with full cost modeling
- `data-loader.ts` — PostgreSQL historical data loader + synthetic data generator
- `report-generator.ts` — Go/No-Go evaluation + Markdown/HTML report generation
- `run-replay.ts` — One-click replay entry point

### Scanner → Dashboard push (`apps/scanner/src/push.ts`)

Each scanner converts detected opportunities into the Dashboard's row shape and pushes them to the API over REST:

- `toOpportunityRow()` — maps a `GraphArbitrageOpportunity` (S1–S5) to `OpportunityRow`
- `toBinaryOpportunityRow()` — maps a `BinaryCompleteSetOpportunity` (S6) to `OpportunityRow`
- `pushOpportunities()` — POSTs a batch or single row to `POST /api/opportunities`; failures are logged, never thrown, so scanners run standalone without a Dashboard

The API accepts both a single `OpportunityRow` and an array (batch upsert), stores rows in memory, broadcasts them over `/ws`, and serves them via `GET /api/dashboard`. With `MOCK_FEED=0` the Dashboard shows only real scanner data.

### API real-time layer (`apps/api/`)

- `dashboard-state.ts` — In-memory dashboard snapshot with incremental updates
- `websocket-plugin.ts` — WebSocket `/ws` endpoint with subscribe/broadcast
- `mock-feed.ts` — Simulated real-time data generator (3s interval)
- REST endpoints: `POST /api/opportunities` (single or batch), `/api/metrics`, `/api/funding`, `/api/markets`, `/api/simulations`, `/api/strategies`
- `GET /api/dashboard` — Full snapshot fallback

### Dashboard (`apps/dashboard/`)

7 pages with Element Plus + ECharts, connects to API via WebSocket (auto-falls back to demo data):

- Overview, Funding Matrix, Opportunities, Opportunity Detail, Market Explorer, Simulation Results, Strategy Performance

## 9. Deferred decisions

The following decisions are intentionally deferred until their behavior can be specified and tested:

- venue SDK versus direct HTTP/WebSocket clients;
- normalized instrument identity and cross-venue symbol mapping;
- order-book reconstruction and sequence-gap recovery;
- PostgreSQL schema and migration tooling;
- BullMQ queue topology, retry policy, and idempotency keys;
- executable-price, fee, funding, gas, and latency models;
- API resource schemas and dashboard information architecture;
- deployment, observability, and retention policy.
