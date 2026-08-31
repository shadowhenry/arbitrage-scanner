import { Decimal } from '@arbitrage-scanner/core';
import { toOpportunityRow, pushOpportunities } from '../apps/scanner/src/push.js';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3000';

// Minimal GraphArbitrageOpportunity-like object (fields used by toOpportunityRow).
const opp = {
  strategyId: 'S4',
  assetSymbol: 'SOL',
  buyVenueId: 'binance',
  sellVenueId: 'jupiter',
  capitalBucketUsd: 10000,
  executableCapitalUsd: new Decimal('2000'),
  executableBaseQuantity: new Decimal('10'),
  buyCostUsd: new Decimal('1980'),
  sellProceedsUsd: new Decimal('2010'),
  grossTradeProfitUsd: new Decimal('30'),
  fundingProfitUsd: new Decimal('0'),
  entryFeesUsd: new Decimal('3'),
  exitFeesEstimateUsd: new Decimal('2'),
  returnOnCapital: new Decimal('0.0125'),
} as never;

const now = new Date();
const row = toOpportunityRow(opp as never, 198, 201, now);
console.log('Converted row:', JSON.stringify(row, null, 2));

async function main(): Promise<void> {
  // Push batch (array) to the API.
  await pushOpportunities([row]);

  // Push single object (should also work).
  const row2 = { ...row, id: 'opp-S4-BTC-binance-jupiter-10000', asset: 'BTC' };
  await pushOpportunities([row2]);

  // Wait for API to process.
  await new Promise((r) => setTimeout(r, 500));

  const res = await fetch(`${API_URL}/api/dashboard`);
  const snapshot = await res.json();
  console.log('Dashboard opportunities after push:', snapshot.opportunities.length);
  for (const o of snapshot.opportunities) {
    console.log(`  ${o.id} ${o.asset} ${o.strategy} edge=${o.netEdgeBps} profit=${o.expectedProfitUsd}`);
  }
  console.log('VERIFY_PUSH_DONE');
}

void main();
