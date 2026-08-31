import {
  Decimal,
  type Asset,
  type Venue,
} from '@arbitrage-scanner/core';
import {
  BinanceSpotAdapter,
  type BinanceSpotState,
  type BinanceSymbol,
} from '@arbitrage-scanner/venues/binance';
import {
  JupiterAdapter,
  JUPITER_VENUE,
  type JupiterMarketConfig,
  type JupiterToken,
} from '@arbitrage-scanner/venues/jupiter';
import {
  scanArbitrageGraph,
  type GraphArbitrageOpportunity,
  type OrderBookGraphNode,
  type RoutingGraphNode,
} from '@arbitrage-scanner/strategies';
import { calculateGasCost, DEFAULT_GAS_CONFIG } from '@arbitrage-scanner/risk';
import { pushOpportunities, toOpportunityRow } from './push.js';

// ============================================================================
// Token and venue definitions
// ============================================================================

const BINANCE_VENUE: Venue = { id: 'binance', name: 'Binance', kind: 'cex' };

const SOL_ASSET: Asset = { symbol: 'SOL', name: 'Solana', decimals: 9 };
const USDT_ASSET: Asset = { symbol: 'USDT', name: 'Tether', decimals: 6 };
const USDC_ASSET: Asset = { symbol: 'USDC', name: 'USD Coin', decimals: 6 };

const JUPITER_SOL: JupiterToken = {
  symbol: 'SOL',
  name: 'Wrapped SOL',
  decimals: 9,
  network: 'solana',
  contractAddress: 'So11111111111111111111111111111111111111112',
};
const JUPITER_USDC: JupiterToken = {
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  network: 'solana',
  contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

const JUPITER_MARKETS: readonly JupiterMarketConfig[] = [
  { inputToken: JUPITER_USDC, outputToken: JUPITER_SOL },  // buy SOL with USDC
  { inputToken: JUPITER_SOL, outputToken: JUPITER_USDC },  // sell SOL for USDC
] as const;

const BINANCE_SYMBOLS = ['SOLUSDT'] as const satisfies readonly BinanceSymbol[];

// Binance spot taker fee (default tier)
const BINANCE_TAKER_FEE = '0.001';
// DEX taker fee is implicit in route quotes; set to 0 for graph node
const DEX_TAKER_FEE = '0';

// ============================================================================
// State
// ============================================================================

let binanceState: BinanceSpotState | undefined;
let jupiterBuyCurve: Awaited<ReturnType<JupiterAdapter['getCurve']>> | undefined;
let jupiterSellCurve: Awaited<ReturnType<JupiterAdapter['getCurve']>> | undefined;

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'scan:cex-dex',
  error: error.message,
  timestamp: new Date().toISOString(),
}));

// ============================================================================
// Binance Spot adapter
// ============================================================================

const binance = new BinanceSpotAdapter({
  symbols: BINANCE_SYMBOLS,
  onState: (_symbol, state) => { binanceState = state; },
  onError: reportError,
});

// ============================================================================
// Jupiter adapter
// ============================================================================

const jupiterApiKey = process.env.JUPITER_API_KEY ?? '';
let jupiter: JupiterAdapter | null = null;

if (jupiterApiKey.trim() !== '') {
  jupiter = new JupiterAdapter({
    markets: JUPITER_MARKETS,
    apiKey: jupiterApiKey,
    slippageBps: Number(process.env.JUPITER_SLIPPAGE_BPS ?? '50'),
    cacheTtlMs: Number(process.env.JUPITER_CACHE_TTL_MS ?? '2000'),
  });
} else {
  console.warn(JSON.stringify({
    service: 'scan:cex-dex',
    warning: 'JUPITER_API_KEY not set, S4 scanner will only use cached/empty DEX data',
    timestamp: new Date().toISOString(),
  }));
}

async function refreshJupiterQuotes(): Promise<void> {
  if (jupiter === null) return;
  try {
    const curves = await jupiter.getConfiguredCurves();
    for (const curve of curves) {
      if (curve.inputAsset.symbol === 'USDC') {
        jupiterBuyCurve = curve;
      } else if (curve.inputAsset.symbol === 'SOL') {
        jupiterSellCurve = curve;
      }
    }
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)));
  }
}

// ============================================================================
// Graph construction
// ============================================================================

function buildBinanceNode(): OrderBookGraphNode | null {
  if (binanceState === undefined || binanceState.orderBook === undefined || binanceState.stale) {
    return null;
  }
  return {
    id: 'binance:spot:SOLUSDT',
    venue: BINANCE_VENUE,
    marketType: 'spot',
    baseAsset: SOL_ASSET,
    quoteAsset: USDT_ASSET,
    takerFeeRate: BINANCE_TAKER_FEE,
    observedAt: binanceState.orderBook.observedAt,
    executionKind: 'orderbook',
    orderBook: binanceState.orderBook,
  };
}

function buildJupiterNode(): RoutingGraphNode | null {
  if (jupiterBuyCurve === undefined || jupiterSellCurve === undefined) {
    return null;
  }
  const observedAt = jupiterBuyCurve.observedAt > jupiterSellCurve.observedAt
    ? jupiterBuyCurve.observedAt
    : jupiterSellCurve.observedAt;
  return {
    id: 'jupiter:spot:SOLUSDC',
    venue: JUPITER_VENUE,
    marketType: 'spot',
    baseAsset: SOL_ASSET,
    quoteAsset: USDC_ASSET,
    takerFeeRate: DEX_TAKER_FEE,
    observedAt,
    executionKind: 'routing',
    buyCurve: jupiterBuyCurve,
    sellCurve: jupiterSellCurve,
  };
}

// ============================================================================
// Opportunity detection and cost adjustment
// ============================================================================

interface S4OpportunityEnriched {
  readonly opportunity: GraphArbitrageOpportunity;
  readonly gasCostUsd: Decimal;
  readonly netProfitAfterGasUsd: Decimal;
  readonly netEdgeAfterGasBps: Decimal;
}

function enrichWithGasCost(
  opportunity: GraphArbitrageOpportunity,
  solPriceUsd: Decimal.Value,
): S4OpportunityEnriched {
  const gasCost = calculateGasCost({
    ...DEFAULT_GAS_CONFIG,
    solPriceUsd,
    priorityFeeMicroLamports: Number(process.env.SIM_GAS_PRIORITY_FEE ?? '50000'),
  });
  const netProfit = opportunity.expectedProfitUsd.minus(gasCost.totalUsd);
  const netEdge = netProfit.div(opportunity.executableCapitalUsd).mul(10_000);
  return {
    opportunity,
    gasCostUsd: gasCost.totalUsd,
    netProfitAfterGasUsd: netProfit,
    netEdgeAfterGasBps: netEdge,
  };
}

function detectOpportunities(): readonly S4OpportunityEnriched[] {
  const binanceNode = buildBinanceNode();
  const jupiterNode = buildJupiterNode();
  if (binanceNode === null || jupiterNode === null) {
    return [];
  }

  const opportunities = scanArbitrageGraph([binanceNode, jupiterNode], {
    maxDataAgeMs: Number(process.env.S4_MAX_DATA_AGE_MS ?? '10000'),
    requirePositiveProfit: true,
    includeDerivativeExitFees: false,
  });

  // Filter to S4 only (CEX/DEX cross-venue)
  const s4Opportunities = opportunities.filter((opp) => opp.strategyId === 'S4');

  // Estimate SOL price from Binance order book for gas conversion
  const solPrice = binanceNode.orderBook.asks[0]?.price ?? '150';

  return s4Opportunities
    .map((opp) => enrichWithGasCost(opp, solPrice))
    .filter((enriched) => enriched.netProfitAfterGasUsd.greaterThan(0))
    .sort((a, b) => b.netProfitAfterGasUsd.comparedTo(a.netProfitAfterGasUsd));
}

// ============================================================================
// Main loop
// ============================================================================

const scanIntervalMs = Number(process.env.S4_SCAN_INTERVAL_MS ?? '3000');
const jupiterRefreshIntervalMs = Number(process.env.S4_JUPITER_REFRESH_MS ?? '2000');

// Initial Jupiter refresh
void refreshJupiterQuotes();

const jupiterTimer = setInterval(() => { void refreshJupiterQuotes(); }, jupiterRefreshIntervalMs);

const scanTimer = setInterval(() => {
  try {
    const opportunities = detectOpportunities();
    const now = new Date();
    const observedAt = now.toISOString();
    if (opportunities.length > 0) {
      const rows = opportunities.map((enriched) => toOpportunityRow(
        enriched.opportunity,
        enriched.opportunity.buyCostUsd
          .div(enriched.opportunity.executableBaseQuantity)
          .toNumber(),
        enriched.opportunity.sellProceedsUsd
          .div(enriched.opportunity.executableBaseQuantity)
          .toNumber(),
        now,
      ));
      void pushOpportunities(rows);
      console.log(JSON.stringify({
        strategy: 'S4',
        readOnly: true,
        observedAt,
        opportunityCount: opportunities.length,
        opportunities: opportunities.map((enriched) => ({
          id: enriched.opportunity.id,
          asset: enriched.opportunity.assetSymbol,
          buyVenue: enriched.opportunity.buyVenueId,
          sellVenue: enriched.opportunity.sellVenueId,
          capitalBucketUsd: enriched.opportunity.capitalBucketUsd,
          executableCapitalUsd: enriched.opportunity.executableCapitalUsd.toString(),
          grossProfitUsd: enriched.opportunity.expectedProfitUsd.toString(),
          gasCostUsd: enriched.gasCostUsd.toString(),
          netProfitUsd: enriched.netProfitAfterGasUsd.toString(),
          netEdgeBps: enriched.netEdgeAfterGasBps.toString(),
          buyCostUsd: enriched.opportunity.buyCostUsd.toString(),
          sellProceedsUsd: enriched.opportunity.sellProceedsUsd.toString(),
          entryFeesUsd: enriched.opportunity.entryFeesUsd.toString(),
        })),
      }));
    } else {
      console.log(JSON.stringify({
        strategy: 'S4',
        readOnly: true,
        observedAt,
        opportunityCount: 0,
        note: 'No positive-net-profit S4 opportunities after gas adjustment',
      }));
    }
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)));
  }
}, scanIntervalMs);

function shutdown() {
  clearInterval(scanTimer);
  clearInterval(jupiterTimer);
  binance.stop();
  jupiter?.clearCache();
}

process.once('SIGINT', () => { shutdown(); process.exitCode = 0; });
process.once('SIGTERM', () => { shutdown(); process.exitCode = 0; });

binance.start();

export { detectOpportunities, shutdown, buildBinanceNode, buildJupiterNode };
export type { S4OpportunityEnriched };
