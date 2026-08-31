# Arbitrage Scanner

Read-only, market-neutral arbitrage research platform. Phase 1 continuously scans multiple venues and detects executable arbitrage opportunities — no real-money trading.

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

## Quick start

```bash
# Install
pnpm install

# Start API with mock data (port 3000)
pnpm api:dev

# Start Dashboard (port 5173) — in another terminal
pnpm dashboard:dev
```

Open http://localhost:5173. The dashboard connects to the API via WebSocket and shows live-updating data.

## Run a scanner

```bash
# All CEX strategies (S1+S2+S3)
pnpm scan:cex

# CEX-DEX (S4)
pnpm scan:cex-dex

# DEX-DEX (S5)
pnpm scan:dex-dex

# Polymarket (S6)
pnpm scan:polymarket
```

## Run shadow simulation

```bash
# Synthetic 30-day replay (no database needed)
SYNTHETIC=1 pnpm --filter @arbitrage-scanner/simulator replay:synthetic
```

## Project structure

```text
apps/
  collector/    Market data ingestion (Binance, Bybit, Hyperliquid, Jupiter, Solana)
  scanner/      Strategy evaluation (6 strategies)
  simulator/    Event-driven replay engine + cost models + report generation
  api/          Fastify API + WebSocket real-time push + mock data feed
  dashboard/    Vue 3 + Element Plus + ECharts (7 pages)

packages/
  core/         Normalized domain types
  venues/       7 venue adapters (all implemented)
  strategies/   6 strategy pure functions + universal arbitrage graph
  risk/         Opportunity validation + 4 simulation cost models
  execution/    Read-only execution boundary (Phase 1)
  database/     PostgreSQL schema + migrations
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Full architecture, dependency rules, implementation status
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Local development + production deployment
- [SHADOW_SIMULATION.md](./SHADOW_SIMULATION.md) — 30-day shadow simulation guide
- [AGENTS.md](./AGENTS.md) — Project rules and conventions

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Safety

Phase 1 is **read-only**. No private keys, no real trading, no authenticated APIs. All secrets belong in environment variables and are never logged.
# arbitrage-scanner
