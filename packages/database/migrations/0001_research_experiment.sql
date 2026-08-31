-- Plain PostgreSQL schema for the 30-day read-only arbitrage research experiment.
-- Financial values use NUMERIC to avoid binary floating-point rounding.

CREATE TABLE venues (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cex', 'dex', 'prediction')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol text NOT NULL,
  name text,
  network text,
  contract_address text,
  decimals smallint CHECK (decimals BETWEEN 0 AND 38),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (symbol, network, contract_address)
);

CREATE TABLE markets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venue_id smallint NOT NULL REFERENCES venues(id),
  external_id text NOT NULL,
  symbol text NOT NULL,
  market_type text NOT NULL CHECK (market_type IN ('spot', 'perpetual', 'prediction')),
  base_asset_id bigint NOT NULL REFERENCES assets(id),
  quote_asset_id bigint NOT NULL REFERENCES assets(id),
  resolution_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, external_id),
  CHECK (base_asset_id <> quote_asset_id),
  CHECK ((market_type = 'prediction') OR resolution_at IS NULL)
);

CREATE TABLE market_quotes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id bigint NOT NULL REFERENCES markets(id),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  best_bid numeric(38, 18),
  best_ask numeric(38, 18),
  last_price numeric(38, 18),
  mark_price numeric(38, 18),
  index_price numeric(38, 18),
  source_sequence text,
  raw_data jsonb,
  CHECK (best_bid IS NULL OR best_bid > 0),
  CHECK (best_ask IS NULL OR best_ask > 0),
  CHECK (best_bid IS NULL OR best_ask IS NULL OR best_ask >= best_bid)
);

CREATE TABLE funding_rates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id bigint NOT NULL REFERENCES markets(id),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  interval_rate numeric(38, 24) NOT NULL,
  interval_hours numeric(12, 6) NOT NULL CHECK (interval_hours > 0),
  hourly_rate numeric(38, 24) NOT NULL,
  annualized_rate numeric(38, 24) NOT NULL,
  next_funding_at timestamptz,
  source_sequence text,
  raw_data jsonb,
  UNIQUE (market_id, observed_at, interval_hours)
);

CREATE TABLE orderbook_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id bigint NOT NULL REFERENCES markets(id),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source_sequence text,
  depth_levels integer NOT NULL CHECK (depth_levels >= 0),
  best_bid numeric(38, 18),
  best_ask numeric(38, 18),
  bid_notional_usd numeric(38, 8) CHECK (bid_notional_usd IS NULL OR bid_notional_usd >= 0),
  ask_notional_usd numeric(38, 8) CHECK (ask_notional_usd IS NULL OR ask_notional_usd >= 0),
  bids jsonb NOT NULL CHECK (jsonb_typeof(bids) = 'array'),
  asks jsonb NOT NULL CHECK (jsonb_typeof(asks) = 'array'),
  checksum text,
  CHECK (best_bid IS NULL OR best_bid > 0),
  CHECK (best_ask IS NULL OR best_ask > 0)
);

-- One row describes a persistent two-leg relationship. Measurements belong in opportunity_ticks.
CREATE TABLE opportunities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  opportunity_key text NOT NULL,
  strategy_id text NOT NULL CHECK (strategy_id IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6')),
  symbol text NOT NULL,
  buy_venue_id smallint NOT NULL REFERENCES venues(id),
  sell_venue_id smallint NOT NULL REFERENCES venues(id),
  buy_market_id bigint NOT NULL REFERENCES markets(id),
  sell_market_id bigint NOT NULL REFERENCES markets(id),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, opportunity_key),
  CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE opportunity_ticks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  capital_bucket_usd numeric(18, 2) NOT NULL CHECK (capital_bucket_usd > 0),
  executable_capital_usd numeric(38, 8) NOT NULL CHECK (executable_capital_usd > 0),
  executable_base_quantity numeric(38, 18) NOT NULL CHECK (executable_base_quantity > 0),
  buy_vwap numeric(38, 18) NOT NULL CHECK (buy_vwap > 0),
  sell_vwap numeric(38, 18) NOT NULL CHECK (sell_vwap > 0),
  gross_profit_usd numeric(38, 8) NOT NULL,
  fees_usd numeric(38, 8) NOT NULL CHECK (fees_usd >= 0),
  slippage_usd numeric(38, 8) NOT NULL CHECK (slippage_usd >= 0),
  funding_profit_usd numeric(38, 8) NOT NULL DEFAULT 0,
  expected_profit_usd numeric(38, 8) NOT NULL,
  return_on_capital numeric(38, 24) NOT NULL,
  net_edge_bps numeric(38, 12) NOT NULL,
  available_capacity_usd numeric(38, 8) CHECK (available_capacity_usd IS NULL OR available_capacity_usd >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (opportunity_id, observed_at, capital_bucket_usd)
);

CREATE TABLE simulation_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  experiment_start_at timestamptz NOT NULL,
  experiment_end_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  initial_capital_usd numeric(38, 8) NOT NULL CHECK (initial_capital_usd > 0),
  final_capital_usd numeric(38, 8),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (experiment_end_at > experiment_start_at),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

-- One row per simulated leg. No table in this migration can represent or submit a real order.
CREATE TABLE simulated_trades (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  simulation_run_id bigint NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
  opportunity_tick_id bigint REFERENCES opportunity_ticks(id) ON DELETE SET NULL,
  market_id bigint NOT NULL REFERENCES markets(id),
  venue_id smallint NOT NULL REFERENCES venues(id),
  strategy_id text NOT NULL CHECK (strategy_id IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6')),
  leg_number smallint NOT NULL CHECK (leg_number > 0),
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  simulated_at timestamptz NOT NULL,
  price numeric(38, 18) NOT NULL CHECK (price > 0),
  base_quantity numeric(38, 18) NOT NULL CHECK (base_quantity > 0),
  notional_usd numeric(38, 8) NOT NULL CHECK (notional_usd > 0),
  fee_usd numeric(38, 8) NOT NULL DEFAULT 0 CHECK (fee_usd >= 0),
  slippage_usd numeric(38, 8) NOT NULL DEFAULT 0 CHECK (slippage_usd >= 0),
  funding_pnl_usd numeric(38, 8) NOT NULL DEFAULT 0,
  realized_pnl_usd numeric(38, 8),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (simulation_run_id, opportunity_tick_id, leg_number)
);

-- Required research access paths.
CREATE INDEX market_quotes_observed_at_idx ON market_quotes (observed_at DESC);
CREATE INDEX market_quotes_market_time_idx ON market_quotes (market_id, observed_at DESC);
CREATE INDEX funding_rates_observed_at_idx ON funding_rates (observed_at DESC);
CREATE INDEX funding_rates_market_time_idx ON funding_rates (market_id, observed_at DESC);
CREATE INDEX orderbook_snapshots_observed_at_idx ON orderbook_snapshots (observed_at DESC);
CREATE INDEX orderbook_snapshots_market_time_idx ON orderbook_snapshots (market_id, observed_at DESC);
CREATE INDEX markets_symbol_idx ON markets (symbol);
CREATE INDEX markets_venue_idx ON markets (venue_id);
CREATE INDEX opportunities_symbol_idx ON opportunities (symbol);
CREATE INDEX opportunities_strategy_idx ON opportunities (strategy_id);
CREATE INDEX opportunities_buy_venue_idx ON opportunities (buy_venue_id);
CREATE INDEX opportunities_sell_venue_idx ON opportunities (sell_venue_id);
CREATE INDEX opportunities_last_seen_idx ON opportunities (last_seen_at DESC);
CREATE INDEX opportunity_ticks_observed_at_idx ON opportunity_ticks (observed_at DESC);
CREATE INDEX opportunity_ticks_opportunity_time_idx ON opportunity_ticks (opportunity_id, observed_at DESC);
CREATE INDEX opportunity_ticks_net_edge_idx ON opportunity_ticks (net_edge_bps DESC, observed_at DESC);
CREATE INDEX opportunity_ticks_expected_profit_idx ON opportunity_ticks (expected_profit_usd DESC, observed_at DESC);
CREATE INDEX simulation_runs_created_at_idx ON simulation_runs (created_at DESC);
CREATE INDEX simulated_trades_timestamp_idx ON simulated_trades (simulated_at DESC);
CREATE INDEX simulated_trades_strategy_idx ON simulated_trades (strategy_id);
CREATE INDEX simulated_trades_venue_idx ON simulated_trades (venue_id);
CREATE INDEX simulated_trades_run_time_idx ON simulated_trades (simulation_run_id, simulated_at);
