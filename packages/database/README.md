# Research database

This schema targets a bounded 30-day experiment and uses plain PostgreSQL 17. TimescaleDB is not justified yet: the experiment has a short retention window, no continuous-aggregate requirement, and PostgreSQL indexes cover the planned access paths. Reconsider hypertables only after measured write volume or retention/query latency shows that native tables and time-based deletion are inadequate.

## Storage model

- `venues`, `assets`, and `markets` are dimensions.
- `market_quotes`, `funding_rates`, and `orderbook_snapshots` are append-only observations.
- `opportunities` identifies a stable two-leg relationship; `opportunity_ticks` stores its capital-bucket measurements over time.
- `simulation_runs` stores experiment configuration and status; `simulated_trades` stores one row per simulated leg.
- Prices, rates, quantities, and PnL use `numeric`, never floating-point types.
- Order book levels use JSONB arrays because the experiment normally retrieves whole snapshots. This avoids multiplying every snapshot into many level rows while retaining the exact normalized depth.

Apply migrations after PostgreSQL is healthy:

```sh
pnpm db:migrate
```

The runner uses a transaction, an advisory lock, and SHA-256 checksums. It refuses to continue if an already-applied migration was edited.

Retention is intentionally an application/operations policy rather than an automatic destructive job. After exporting experiment results, old observations can be deleted in bounded time ranges using the indexed timestamp columns.
