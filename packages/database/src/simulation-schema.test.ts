import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../migrations/0002_simulation_support.sql', import.meta.url),
);

describe('simulation support schema (0002)', () => {
  it('creates dex_quotes with direction, capital bucket, and route audit fields', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE dex_quotes');
    for (const column of [
      'venue_id', 'market_id', 'observed_at', 'direction', 'capital_bucket_usd',
      'input_amount', 'output_amount', 'effective_price', 'price_impact_pct',
      'context_slot', 'route_plan', 'dex_labels', 'pools', 'liquidity_usd',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("CHECK (direction IN ('buy', 'sell'))");
    expect(sql).toContain('UNIQUE (market_id, observed_at, direction, capital_bucket_usd)');
  });

  it('creates solana_network_state with priority-fee percentiles and congestion score', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE solana_network_state');
    for (const column of [
      'recent_block_time_ms', 'tps',
      'priority_fee_p25_micro_lamports', 'priority_fee_p50_micro_lamports',
      'priority_fee_p75_micro_lamports', 'priority_fee_p95_micro_lamports',
      'estimated_compute_units', 'congestion_score',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('CHECK (congestion_score IS NULL OR (congestion_score >= 0 AND congestion_score <= 1))');
  });

  it('creates inventory_snapshots with CEX and on-chain balances', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE inventory_snapshots');
    for (const column of [
      'simulation_run_id', 'observed_at',
      'cex_usdc', 'cex_sol', 'chain_usdc', 'chain_sol',
      'total_value_usd', 'allocation_deviation_bps',
      'rebalance_triggered', 'rebalance_reason',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('REFERENCES simulation_runs(id) ON DELETE CASCADE');
  });

  it('enriches simulated_trades with gas, failure, latency, and inventory audit fields', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('ALTER TABLE simulated_trades');
    for (const column of [
      'gas_fee_usd', 'network_fee_usd', 'priority_fee_usd',
      'failure_reason', 'cex_executed', 'dex_executed',
      'execution_latency_ms', 'price_drift_bps',
      'inventory_before', 'inventory_after',
      'solana_slot', 'priority_fee_micro_lamports',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('CHECK (gas_fee_usd >= 0)');
    expect(sql).toContain('WHERE failure_reason IS NOT NULL');
  });

  it('uses NUMERIC for all financial values and jsonb for complex structures', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    // No floating-point types for money
    expect(sql.toLowerCase()).not.toContain('double precision');
    expect(sql.toLowerCase()).not.toContain(' real ');
    // JSONB used for route plans, inventory snapshots, raw data
    expect(sql).toContain('jsonb');
  });
});
