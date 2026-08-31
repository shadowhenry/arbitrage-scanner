-- Schema extensions for 30-day CEX-DEX shadow simulation.
-- Adds DEX quote persistence, Solana network state, inventory tracking,
-- and enriched simulated-trade audit fields. All financial values use NUMERIC.

-- ============================================================================
-- DEX routing quotes (Jupiter / Raydium)
-- One row per (market, observed_at, capital bucket). Stores the exact
-- router output so the simulator can replay executable prices without
-- re-querying the venue.
-- ============================================================================
CREATE TABLE dex_quotes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venue_id smallint NOT NULL REFERENCES venues(id),
  market_id bigint NOT NULL REFERENCES markets(id),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- Direction: 'buy' means input=quote(USDC), output=base(SOL)
  --            'sell' means input=base(SOL), output=quote(USDC)
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  capital_bucket_usd numeric(18, 2) NOT NULL CHECK (capital_bucket_usd > 0),
  input_amount numeric(38, 18) NOT NULL CHECK (input_amount > 0),
  output_amount numeric(38, 18) NOT NULL CHECK (output_amount > 0),
  effective_price numeric(38, 18) NOT NULL CHECK (effective_price > 0),
  price_impact_pct numeric(38, 12) NOT NULL CHECK (price_impact_pct >= 0),
  -- Router-specific context
  context_slot text,
  quote_age_ms integer CHECK (quote_age_ms IS NULL OR quote_age_ms >= 0),
  -- Full route plan for auditability (AMM keys, labels, per-hop fees)
  route_plan jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(route_plan) = 'array'),
  dex_labels text[] NOT NULL DEFAULT '{}',
  -- Liquidity sources touched by the route
  pools jsonb,
  liquidity_usd numeric(38, 8) CHECK (liquidity_usd IS NULL OR liquidity_usd >= 0),
  raw_response jsonb,
  UNIQUE (market_id, observed_at, direction, capital_bucket_usd)
);

CREATE INDEX dex_quotes_observed_at_idx ON dex_quotes (observed_at DESC);
CREATE INDEX dex_quotes_market_time_idx ON dex_quotes (market_id, observed_at DESC);
CREATE INDEX dex_quotes_venue_time_idx ON dex_quotes (venue_id, observed_at DESC);
CREATE INDEX dex_quotes_direction_bucket_idx ON dex_quotes (direction, capital_bucket_usd);

-- ============================================================================
-- Solana network state
-- Captures congestion and priority-fee environment so the simulator can
-- correlate execution quality with network conditions.
-- ============================================================================
CREATE TABLE solana_network_state (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- Recent block timing (ms)
  recent_block_time_ms numeric(12, 2),
  block_height bigint,
  -- Transactions per second (rolling window)
  tps numeric(12, 2),
  -- Priority fee percentiles in micro-lamports per compute unit
  priority_fee_p25_micro_lamports numeric(18, 2),
  priority_fee_p50_micro_lamports numeric(18, 2),
  priority_fee_p75_micro_lamports numeric(18, 2),
  priority_fee_p95_micro_lamports numeric(18, 2),
  -- Estimated compute units for a typical Jupiter swap
  estimated_compute_units integer,
  -- Congestion score 0.0 (idle) to 1.0 (saturated)
  congestion_score numeric(5, 4) CHECK (congestion_score IS NULL OR (congestion_score >= 0 AND congestion_score <= 1)),
  raw_data jsonb
);

CREATE INDEX solana_network_state_observed_at_idx ON solana_network_state (observed_at DESC);

-- ============================================================================
-- Inventory snapshots (for shadow simulation)
-- Tracks pre-funded inventory on CEX and on-chain over time.
-- ============================================================================
CREATE TABLE inventory_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  simulation_run_id bigint NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  -- CEX-side balances
  cex_usdc numeric(38, 18) NOT NULL CHECK (cex_usdc >= 0),
  cex_sol numeric(38, 18) NOT NULL CHECK (cex_sol >= 0),
  -- On-chain balances
  chain_usdc numeric(38, 18) NOT NULL CHECK (chain_usdc >= 0),
  chain_sol numeric(38, 18) NOT NULL CHECK (chain_sol >= 0),
  -- Total inventory value in USD (mark-to-market at snapshot time)
  total_value_usd numeric(38, 8) NOT NULL CHECK (total_value_usd >= 0),
  -- Deviation from target allocation (basis points)
  allocation_deviation_bps numeric(38, 12),
  -- Whether a rebalance was triggered at this snapshot
  rebalance_triggered boolean NOT NULL DEFAULT false,
  rebalance_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX inventory_snapshots_run_time_idx ON inventory_snapshots (simulation_run_id, observed_at);

-- ============================================================================
-- Enrich simulated_trades with execution-quality audit fields
-- ============================================================================
ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS gas_fee_usd numeric(38, 8) NOT NULL DEFAULT 0 CHECK (gas_fee_usd >= 0),
  ADD COLUMN IF NOT EXISTS network_fee_usd numeric(38, 8) NOT NULL DEFAULT 0 CHECK (network_fee_usd >= 0),
  ADD COLUMN IF NOT EXISTS priority_fee_usd numeric(38, 8) NOT NULL DEFAULT 0 CHECK (priority_fee_usd >= 0),
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS cex_executed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dex_executed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS execution_latency_ms integer CHECK (execution_latency_ms IS NULL OR execution_latency_ms >= 0),
  ADD COLUMN IF NOT EXISTS price_drift_bps numeric(38, 12),
  ADD COLUMN IF NOT EXISTS inventory_before jsonb,
  ADD COLUMN IF NOT EXISTS inventory_after jsonb,
  ADD COLUMN IF NOT EXISTS solana_slot text,
  ADD COLUMN IF NOT EXISTS priority_fee_micro_lamports numeric(18, 2);

-- Index for failure analysis
CREATE INDEX simulated_trades_failure_idx ON simulated_trades (failure_reason) WHERE failure_reason IS NOT NULL;
CREATE INDEX simulated_trades_cex_dex_executed_idx ON simulated_trades (cex_executed, dex_executed);
