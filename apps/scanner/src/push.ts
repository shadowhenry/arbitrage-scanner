import { Decimal } from '@arbitrage-scanner/core';
import type { GraphArbitrageOpportunity } from '@arbitrage-scanner/strategies';
import type { BinaryCompleteSetOpportunity } from '@arbitrage-scanner/strategies';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

type StrategyId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';

/** Shape accepted by the API dashboard (see apps/api/src/dashboard-types.ts). */
export interface OpportunityRow {
  readonly id: string;
  readonly asset: string;
  readonly strategy: StrategyId;
  readonly buyVenue: string;
  readonly sellVenue: string;
  readonly grossEdgeBps: number;
  readonly netEdgeBps: number;
  readonly capacityUsd: number;
  readonly expectedProfitUsd: number;
  readonly returnOnCapital: number;
  readonly duration: string;
  readonly detectedAt: string;
  readonly capitalBucketUsd: number;
  readonly buyVwap: number;
  readonly sellVwap: number;
  readonly feesUsd: number;
  readonly slippageUsd: number;
  readonly fundingProfitUsd: number;
  readonly history: readonly { readonly time: string; readonly edgeBps: number }[];
}

/** Maps a strategy id to the Dashboard strategy enum. */
function strategyIdToDashboard(strategyId: string): StrategyId {
  if (
    strategyId === 'S1' || strategyId === 'S2' || strategyId === 'S3'
    || strategyId === 'S4' || strategyId === 'S5' || strategyId === 'S6'
  ) {
    return strategyId;
  }
  return 'S1';
}

/**
 * Converts a graph opportunity into the Dashboard's OpportunityRow shape.
 * Uses only executable prices; fees/slippage/funding already netted by the engine.
 */
export function toOpportunityRow(
  opp: GraphArbitrageOpportunity,
  buyVwap: number,
  sellVwap: number,
  detectedAt: Date = new Date(),
): OpportunityRow {
  const buyVenue = opp.buyVenueId;
  const sellVenue = opp.sellVenueId;
  const feesUsd = opp.entryFeesUsd.toNumber() + opp.exitFeesEstimateUsd.toNumber();
  const netEdgeBps = opp.returnOnCapital.mul(10_000).toNumber();

  return {
    id: `opp-${opp.strategyId}-${opp.assetSymbol}-${buyVenue}-${sellVenue}-${opp.capitalBucketUsd}`,
    asset: opp.assetSymbol,
    strategy: strategyIdToDashboard(opp.strategyId),
    buyVenue,
    sellVenue,
    grossEdgeBps: opp.grossTradeProfitUsd
      .div(opp.executableCapitalUsd)
      .mul(10_000)
      .toNumber(),
    netEdgeBps,
    capacityUsd: opp.executableCapitalUsd.toNumber(),
    expectedProfitUsd: opp.grossTradeProfitUsd.toNumber(),
    returnOnCapital: opp.returnOnCapital.toNumber(),
    duration: '30s',
    detectedAt: detectedAt.toISOString(),
    capitalBucketUsd: opp.capitalBucketUsd,
    buyVwap,
    sellVwap,
    feesUsd,
    slippageUsd: 0,
    fundingProfitUsd: opp.fundingProfitUsd.toNumber(),
    history: [],
  };
}

/**
 * Converts a Polymarket binary complete-set opportunity into a Dashboard row.
 */
export function toBinaryOpportunityRow(
  opp: BinaryCompleteSetOpportunity,
  detectedAt: Date = new Date(),
): OpportunityRow {
  // Complete set: buy YES + NO, redeem for $1.00. Net edge is the discount below $1.
  const costPerShare = opp.allInCostPerShare;
  const profitPerShare = new Decimal(1).minus(costPerShare);
  const profitUsd = profitPerShare.mul(opp.executableShares).toNumber();
  const edgeBps = profitPerShare.div(costPerShare).mul(10_000).toNumber();

  return {
    id: `opp-S6-${opp.conditionId}-${opp.requestedCapitalUsd}`,
    asset: 'BINARY',
    strategy: 'S6',
    buyVenue: 'polymarket-yes',
    sellVenue: 'polymarket-no',
    grossEdgeBps: edgeBps,
    netEdgeBps: edgeBps,
    capacityUsd: opp.executableCapitalUsd.toNumber(),
    expectedProfitUsd: profitUsd,
    returnOnCapital: profitPerShare.div(costPerShare).toNumber(),
    duration: 'event',
    detectedAt: detectedAt.toISOString(),
    capitalBucketUsd: opp.requestedCapitalUsd,
    buyVwap: opp.yesVwap.toNumber(),
    sellVwap: opp.noVwap.toNumber(),
    feesUsd: opp.feeUsd.toNumber(),
    slippageUsd: opp.slippageBufferUsd.toNumber(),
    fundingProfitUsd: 0,
    history: [],
  };
}

/**
 * Pushes a list of opportunities to the API. Failures are logged but never
 * thrown, so the scanner loop is never blocked by a down API.
 */
export async function pushOpportunities(rows: readonly OpportunityRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const response = await fetch(`${API_URL}/api/opportunities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    });
    if (!response.ok) {
      console.error(JSON.stringify({
        service: 'push',
        phase: 'error',
        httpStatus: response.status,
        apiUrl: API_URL,
        timestamp: new Date().toISOString(),
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      service: 'push',
      phase: 'error',
      error: error instanceof Error ? error.message : String(error),
      apiUrl: API_URL,
      timestamp: new Date().toISOString(),
    }));
  }
}
