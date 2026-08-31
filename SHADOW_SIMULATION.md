# Shadow Simulation Guide

This document describes the 30-day shadow simulation framework for validating
the S4 CEX-DEX arbitrage strategy (Binance Spot ↔ Jupiter/Raydium, SOL/USDC)
before entering live trading.

## Overview

The shadow simulation replays historical market data through the full execution
pipeline with realistic costs:

- **CEX taker fees** (0.1% on Binance Spot)
- **DEX implicit fees** (price impact from routing quotes)
- **Solana gas and priority fees** (dynamic, based on network state)
- **Execution latency and price drift** (CEX ~50-200ms, DEX ~400-2000ms)
- **Trade failure probability** (CEX ~0.2%, DEX ~2.5%, with unwind costs)
- **Pre-funded inventory constraints** (no infinite capital assumption)

All randomness is deterministic given a seed, enabling reproducible A/B testing.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ HistoricalData  │────▶│   ReplayEngine   │────▶│  ReplayMetrics  │
│    Loader       │     │  (event-driven)  │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
         │                          │                         │
         ▼                          ▼                         ▼
  orderbook_snapshots      4 cost models            Go/No-Go evaluation
  dex_quotes               (gas/failure/            + report generation
                           inventory/latency)
```

### Components

1. **HistoricalDataLoader** (`apps/simulator/src/data-loader.ts`)
   - Loads Binance order book snapshots and Jupiter quotes from PostgreSQL
   - Converts to chronological `ReplayEvent` stream
   - Supports synthetic data generation for testing

2. **ReplayEngine** (`apps/simulator/src/replay-engine.ts`)
   - Event-driven: processes market data in time order
   - Detects S4 opportunities in both directions
   - Applies all 4 cost models per trade
   - Tracks inventory, cumulative PnL, and drawdown

3. **Cost Models** (`packages/risk/src/sim-*.ts`)
   - `sim-gas-model.ts`: Solana gas + priority fee calculation
   - `sim-failure-model.ts`: Independent CEX/DEX failure sampling + unwind costs
   - `sim-inventory.ts`: Pre-funded inventory state and execution checks
   - `sim-latency-model.ts`: Execution latency + normal-distribution price drift

4. **ReportGenerator** (`apps/simulator/src/report-generator.ts`)
   - Go/No-Go evaluation against configurable thresholds
   - Markdown and HTML report generation
   - Cost breakdown, failure analysis, PnL timeline

## Quick Start

### 1. Synthetic Test (No Database Required)

```bash
# Run a 30-day synthetic replay
SYNTHETIC=1 pnpm --filter @arbitrage-scanner/simulator replay:synthetic

# Custom parameters
SYNTHETIC=1 \
REPLAY_START="2026-07-01T00:00:00Z" \
REPLAY_END="2026-07-31T23:59:59Z" \
INITIAL_INVENTORY=50000 \
SOL_PRICE=145 \
GAS_PRIORITY_FEE=100000 \
RANDOM_SEED=12345 \
pnpm --filter @arbitrage-scanner/simulator replay
```

### 2. Database Replay (Requires Historical Data)

```bash
# Ensure database is running and migrations applied
pnpm db:migrate

# Run with database data
DATABASE_URL="postgresql://user:pass@localhost:5432/arbitrage" \
BINANCE_MARKET_ID=1 \
JUPITER_MARKET_ID=2 \
REPLAY_START="2026-07-01T00:00:00Z" \
REPLAY_END="2026-07-31T23:59:59Z" \
pnpm --filter @arbitrage-scanner/simulator replay
```

### 3. Output

Reports are written to `apps/simulator/reports/` by default:

- `replay-report-<timestamp>.md` — Full Markdown report
- `replay-report-<timestamp>.html` — HTML report for dashboard/email

## Go/No-Go Criteria

The simulation passes only if **all** checks pass:

| Check | Threshold | Rationale |
|-------|-----------|-----------|
| Median net PnL | > $0 | Strategy must be profitable on average |
| Win rate | ≥ 40% | Enough winning trades to cover losses |
| Max drawdown | ≤ 5% of inventory | Capital preservation |
| Gas/profit ratio | ≤ 40% | Gas must not dominate costs |
| Failure rate | ≤ 15% | Execution reliability |

**If any check fails, the strategy should NOT enter live trading.**

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string (DB mode) |
| `REPLAY_START` | 30 days ago | Start time ISO string |
| `REPLAY_END` | now | End time ISO string |
| `BINANCE_MARKET_ID` | 1 | Market ID for Binance SOL/USDT |
| `JUPITER_MARKET_ID` | 2 | Market ID for Jupiter SOL/USDC |
| `INITIAL_INVENTORY` | 20000 | Total initial inventory USD |
| `SOL_PRICE` | 150 | SOL price for gas calculations |
| `GAS_PRIORITY_FEE` | 50000 | Priority fee in micro-lamports |
| `MIN_PROFIT` | 0.01 | Minimum gross profit threshold USD |
| `RANDOM_SEED` | 42 | Random seed for deterministic runs |
| `SYNTHETIC` | — | Set to "1" for synthetic data |
| `OUTPUT_FORMAT` | both | "markdown", "html", or "both" |
| `OUTPUT_DIR` | ./reports | Output directory for reports |

## Data Collection

For a real 30-day replay, you need historical data in the database:

### 1. Start Collectors

```bash
# Binance, Bybit, Hyperliquid collectors
pnpm --filter @arbitrage-scanner/collector start:prod

# Jupiter DEX quotes (requires API key)
JUPITER_API_KEY=your_key pnpm --filter @arbitrage-scanner/collector jupiter

# Solana network state (requires RPC)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
pnpm --filter @arbitrage-scanner/collector start:prod
```

### 2. Collect for 30 Days

Let the collectors run continuously. Data is stored in:
- `orderbook_snapshots` — Binance order book depth
- `dex_quotes` — Jupiter routing quotes (bidirectional)
- `solana_network_state` — Network health metrics

### 3. Run Replay

After 30 days of data collection, run the replay as described above.

## Cost Model Details

### Gas Model

```
total_gas_usd = (base_fee_lamports + priority_fee_lamports) / 1e9 * sol_price_usd
```

- Base fee: 5000 lamports per signature (2 signatures = 10000)
- Priority fee: configurable in micro-lamports per compute unit
- Compute units: ~400,000 per Jupiter swap

### Failure Model

- CEX failure rate: 0.2% (API timeout, partial fill)
- DEX failure rate: 2.5% (slippage exceeded, network congestion)
- Both legs fail independently
- Single-leg failure incurs $5 unwind cost (close surviving leg)

### Latency Model

- CEX latency: 50-200ms (uniform)
- DEX latency: 400-2000ms (uniform)
- Price drift: normal distribution, σ = 0.04% per second
- Effective latency = max(CEX, DEX) latency

### Inventory Model

- Initial inventory split equally: CEX USDC, CEX SOL, Chain USDC, Chain SOL
- Trades only execute if sufficient inventory on both sides
- After trade: inventory shifts between CEX and chain
- Rebalance needed when one side drops below 20% of initial

## Tuning Parameters

To improve strategy performance, tune these parameters:

1. **Minimum profit threshold** — Higher = fewer trades but better quality
2. **Priority fee** — Higher = faster confirmation but more gas cost
3. **Trade size buckets** — Larger = more price impact but fewer gas overhead
4. **Inventory allocation** — More chain SOL = fewer rebalances but higher risk

## Next Steps After Passing

1. **Monte Carlo validation**: Run 1000+ replays with different seeds to confirm PnL distribution stability
2. **Paper trading**: Connect real order routing but don't execute; compare simulated vs. actual fills
3. **Gradual capital**: Start with 10% of target inventory, scale up after 7 days of consistent results
4. **Real-time monitoring**: Track live metrics against simulation baseline; pause if deviation exceeds 2σ

## Known Limitations

1. **USDT/USDC peg**: Current implementation assumes 1:1; real conversion may have 1-5 bps cost
2. **Simplified order book**: Uses top-of-book only; full depth integration planned
3. **Static failure rates**: Real failure rates vary with network congestion; dynamic model planned
4. **No MEV/sandwich risk**: DEX trades may be front-run; not currently modeled
5. **No rebalance costs**: Inventory rebalancing trades incur fees not currently counted
