import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL('../migrations/0001_research_experiment.sql', import.meta.url));

describe('research experiment schema', () => {
  it('creates every required entity with no TimescaleDB dependency', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    for (const table of [
      'venues', 'markets', 'assets', 'market_quotes', 'funding_rates',
      'orderbook_snapshots', 'opportunities', 'opportunity_ticks',
      'simulation_runs', 'simulated_trades',
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql.toLowerCase()).not.toContain('timescaledb');
    expect(sql.toLowerCase()).not.toContain('create_hypertable');
  });

  it('defines the required timestamp, symbol, strategy, venue, edge and profit indexes', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    for (const fragment of [
      'observed_at_idx', 'symbol_idx', 'strategy_idx', 'venue_idx',
      'net_edge_idx', 'expected_profit_idx',
    ]) expect(sql).toContain(fragment);
  });
});
