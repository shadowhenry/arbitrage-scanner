# Arbitrage Scanner

## Goal

Build a read-only, market-neutral arbitrage research platform.

Initially DO NOT execute real-money trades.

The system continuously scans:

- Binance
- Bybit
- Hyperliquid
- Jupiter
- Raydium
- Polymarket

and detects executable arbitrage opportunities.

## Tech Stack

- Node.js 22
- TypeScript
- pnpm
- PostgreSQL
- Redis
- BullMQ
- Fastify
- Vue 3
- Element Plus
- ECharts
- Docker Compose

## Architecture Rules

Use a monorepo.

`apps/`:

- `collector`
- `scanner`
- `simulator`
- `api`
- `dashboard`

`packages/`:

- `core`
- `venues`
- `strategies`
- `risk`
- `execution`
- `database`

Venue adapters MUST NOT contain strategy logic.

Strategy modules MUST consume normalized market data.

All calculations must use executable prices rather than last traded prices.

Never treat best bid/ask as executable for arbitrary position size.

## Supported Venues

CEX:

- Binance
- Bybit

Perpetual:

- Binance Futures
- Bybit Linear
- Hyperliquid

Solana:

- Jupiter
- Raydium

Prediction:

- Polymarket

## Strategies

- S1 Spot/Perp Basis
- S2 Perp/Perp Funding Arbitrage
- S3 CEX/CEX Spot Arbitrage
- S4 CEX/DEX Arbitrage
- S5 DEX/DEX Arbitrage
- S6 Polymarket Binary Arbitrage

## Safety

Phase 1 is READ ONLY.

Do not implement real trading unless explicitly requested.

Do not request or store private keys.

Do not hardcode API keys.

All secrets belong in environment variables.

Never log secrets.

## Quality

Use strict TypeScript.

Every strategy must have unit tests.

Every venue adapter must expose normalized types.

Run:

```text
pnpm lint
pnpm typecheck
pnpm test
```

before considering a task complete.
