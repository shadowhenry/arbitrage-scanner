import type { Pool } from 'pg';
import type { RoutingExecutablePriceCurve } from '@arbitrage-scanner/core';

/**
 * Persists a DEX routing quote curve into the `dex_quotes` table.
 * One row per capital bucket per direction.
 *
 * @param pool PostgreSQL connection pool
 * @param venueId Venue foreign key (from `venues` table)
 * @param marketId Market foreign key (from `markets` table)
 * @param curve Normalized routing price curve from Jupiter/Raydium
 * @param direction 'buy' = input USDC → output base; 'sell' = input base → output USDC
 * @returns Number of rows inserted
 */
export async function insertDexQuoteCurve(
  pool: Pool,
  venueId: number,
  marketId: number,
  curve: RoutingExecutablePriceCurve,
  direction: 'buy' | 'sell',
): Promise<number> {
  if (curve.kind !== 'routing') {
    throw new TypeError('insertDexQuoteCurve expects a routing curve, got orderbook');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;

    for (const quote of curve.quotes) {
      const result = await client.query(
        `INSERT INTO dex_quotes (
          venue_id, market_id, observed_at, direction, capital_bucket_usd,
          input_amount, output_amount, effective_price, price_impact_pct,
          context_slot, quote_age_ms, route_plan, dex_labels, pools, liquidity_usd
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (market_id, observed_at, direction, capital_bucket_usd) DO NOTHING`,
        [
          venueId,
          marketId,
          curve.observedAt,
          direction,
          quote.notionalUsd,
          quote.inputAmount.toString(),
          quote.outputAmount.toString(),
          quote.effectivePrice.toString(),
          quote.priceImpact.toString(),
          quote.contextSlot ?? null,
          quote.quoteAgeMs ?? null,
          JSON.stringify(quote.route.map((step) => ({
            ammKey: step.ammKey,
            dexLabel: step.dexLabel,
            inputMint: step.inputMint,
            outputMint: step.outputMint,
            inputAmountAtomic: step.inputAmountAtomic ?? null,
            outputAmountAtomic: step.outputAmountAtomic ?? null,
            feeAmountAtomic: step.feeAmountAtomic ?? null,
            feeMint: step.feeMint ?? null,
            percent: step.percent.toString(),
          }))),
          quote.dexLabels,
          quote.pools !== undefined
            ? JSON.stringify(quote.pools.map((pool) => ({
              poolId: pool.poolId,
              poolType: pool.poolType ?? null,
              liquidityUsd: pool.liquidityUsd.toString(),
            })))
            : null,
          quote.liquidityUsd?.toString() ?? null,
        ],
      );
      inserted += result.rowCount ?? 0;
    }

    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Looks up or creates a venue record by code. Returns the venue's id.
 */
export async function ensureVenue(
  pool: Pool,
  code: string,
  name: string,
  kind: 'cex' | 'dex' | 'prediction',
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO venues (code, name, kind)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind
     RETURNING id`,
    [code, name, kind],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to ensure venue: ${code}`);
  return row.id;
}

/**
 * Looks up or creates a market record. Returns the market's id.
 */
export async function ensureMarket(
  pool: Pool,
  venueId: number,
  externalId: string,
  symbol: string,
  marketType: 'spot' | 'perpetual' | 'prediction',
  baseAssetId: number,
  quoteAssetId: number,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO markets (venue_id, external_id, symbol, market_type, base_asset_id, quote_asset_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (venue_id, external_id) DO UPDATE SET symbol = EXCLUDED.symbol
     RETURNING id`,
    [venueId, externalId, symbol, marketType, baseAssetId, quoteAssetId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to ensure market: ${externalId}`);
  return row.id;
}

/**
 * Looks up or creates an asset record. Returns the asset's id.
 */
export async function ensureAsset(
  pool: Pool,
  symbol: string,
  name: string | undefined,
  network: string | undefined,
  contractAddress: string | undefined,
  decimals: number | undefined,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO assets (symbol, name, network, contract_address, decimals)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (symbol, network, contract_address) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [symbol, name ?? null, network ?? null, contractAddress ?? null, decimals ?? null],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Failed to ensure asset: ${symbol}`);
  return row.id;
}
