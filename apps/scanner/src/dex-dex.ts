import type { Asset, RoutingExecutablePriceCurve } from '@arbitrage-scanner/core';
import {
  scanArbitrageGraph,
  type GraphArbitrageOpportunity,
  type RoutingGraphNode,
} from '@arbitrage-scanner/strategies';
import { pushOpportunities, toOpportunityRow } from './push.js';
import {
  JupiterAdapter,
  JUPITER_VENUE,
  JUPITER_MARKETS,
  type JupiterMarketConfig,
} from '@arbitrage-scanner/venues/jupiter';
import {
  RaydiumAdapter,
  RAYDIUM_VENUE,
} from '@arbitrage-scanner/venues/raydium';

// Use common markets available on both DEXes
const markets: readonly JupiterMarketConfig[] = [
  JUPITER_MARKETS[0], // USDC → SOL
  JUPITER_MARKETS[1], // USDC → WIF
  JUPITER_MARKETS[2], // USDC → BONK
];

const jupiterApiKey = process.env.JUPITER_API_KEY ?? '';
let jupiter: JupiterAdapter | null = null;

if (jupiterApiKey.trim() !== '') {
  jupiter = new JupiterAdapter({
    markets,
    apiKey: jupiterApiKey,
    cacheTtlMs: Number(process.env.JUPITER_CACHE_TTL_MS ?? '5000'),
  });
} else {
  console.warn(JSON.stringify({
    service: 'scan:dex-dex',
    warning: 'JUPITER_API_KEY not set, S5 scanner will skip Jupiter leg',
    timestamp: new Date().toISOString(),
  }));
}

const raydium = new RaydiumAdapter({
  markets,
  cacheTtlMs: Number(process.env.RAYDIUM_CACHE_TTL_MS ?? '5000'),
  slippageBps: Number(process.env.RAYDIUM_SLIPPAGE_BPS ?? '50'),
});

const TAKER_FEES = {
  jupiter: process.env.JUPITER_TAKER_FEE ?? '0.00085',
  raydium: process.env.RAYDIUM_TAKER_FEE ?? '0.0025',
};

interface CurveState {
  readonly venueId: string;
  readonly curve: RoutingExecutablePriceCurve;
  readonly observedAt: Date;
}

const jupiterCurves = new Map<string, CurveState>();
const raydiumCurves = new Map<string, CurveState>();

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'scan:dex-dex', error: error.message, timestamp: new Date().toISOString(),
}));

function curveKey(curve: RoutingExecutablePriceCurve): string {
  return `${curve.outputAsset.symbol}-${curve.inputAsset.symbol}`;
}

function buildRoutingNode(
  venueId: string,
  curve: RoutingExecutablePriceCurve,
  takerFeeRate: string,
): RoutingGraphNode {
  const baseAsset: Asset = curve.outputAsset;
  const quoteAsset: Asset = curve.inputAsset;
  return {
    id: `${venueId}:${curveKey(curve)}`,
    venue: venueId === 'jupiter' ? JUPITER_VENUE : RAYDIUM_VENUE,
    marketType: 'spot',
    baseAsset,
    quoteAsset,
    takerFeeRate,
    observedAt: curve.observedAt,
    executionKind: 'routing',
    buyCurve: curve,
    sellCurve: curve,
  };
}

async function refreshCurves(): Promise<void> {
  try {
    const jupiterTask = jupiter === null
      ? Promise.resolve([] as PromiseSettledResult<RoutingExecutablePriceCurve>[])
      : Promise.allSettled(markets.map((market) => jupiter!.getCurve(market)));
    const [jResults, rResults] = await Promise.all([
      jupiterTask,
      Promise.allSettled(markets.map((market) => raydium.getCurve(market))),
    ]);

    for (const result of jResults) {
      if (result.status === 'fulfilled') {
        const curve = result.value;
        jupiterCurves.set(curveKey(curve), {
          venueId: 'jupiter',
          curve,
          observedAt: curve.observedAt,
        });
      }
    }
    for (const result of rResults) {
      if (result.status === 'fulfilled') {
        const curve = result.value;
        raydiumCurves.set(curveKey(curve), {
          venueId: 'raydium',
          curve,
          observedAt: curve.observedAt,
        });
      }
    }
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)));
  }
}

function scanOnce(): void {
  const now = new Date();
  const nodes: RoutingGraphNode[] = [];

  for (const state of jupiterCurves.values()) {
    if (now.getTime() - state.observedAt.getTime() > 15_000) continue;
    nodes.push(buildRoutingNode('jupiter', state.curve, TAKER_FEES.jupiter));
  }
  for (const state of raydiumCurves.values()) {
    if (now.getTime() - state.observedAt.getTime() > 15_000) continue;
    nodes.push(buildRoutingNode('raydium', state.curve, TAKER_FEES.raydium));
  }

  const allOpportunities = scanArbitrageGraph(nodes, {
    maxDataAgeMs: 15_000,
    requirePositiveProfit: true,
    now,
  });

  // Filter to S5 only (DEX/DEX)
  const s5Opportunities: GraphArbitrageOpportunity[] = allOpportunities.filter(
    (opp) => opp.strategyId === 'S5',
  );

  // Push to Dashboard API (fire-and-forget)
  const rows = s5Opportunities.map((opp) => {
    const vwap = opp.buyCostUsd.plus(opp.sellProceedsUsd)
      .div(opp.executableBaseQuantity.mul(2))
      .toNumber();
    return toOpportunityRow(opp, vwap, vwap, now);
  });
  if (rows.length > 0) void pushOpportunities(rows);

  console.log(JSON.stringify({
    service: 'scan:dex-dex',
    strategy: 'S5',
    readOnly: true,
    observedAt: now.toISOString(),
    jupiterCurveCount: jupiterCurves.size,
    raydiumCurveCount: raydiumCurves.size,
    nodeCount: nodes.length,
    opportunities: s5Opportunities,
  }));
}

console.error(JSON.stringify({
  service: 'scan:dex-dex',
  mode: 'read-only',
  strategy: 'S5 DEX/DEX (Jupiter ↔ Raydium)',
  markets: markets.map((m) => `${m.inputToken.symbol}→${m.outputToken.symbol}`),
  takerFeeAssumptions: TAKER_FEES,
  timestamp: new Date().toISOString(),
}));

// Initial curve refresh
await refreshCurves();

// Refresh curves every 10 seconds
const refreshTimer = setInterval(() => {
  void refreshCurves();
}, 10_000);

// Scan every 5 seconds
const scanTimer = setInterval(scanOnce, 5_000);

// Run first scan immediately
scanOnce();

function shutdown() {
  clearInterval(refreshTimer);
  clearInterval(scanTimer);
  jupiter?.clearCache();
  raydium.clearCache();
}

process.once('SIGINT', () => { shutdown(); process.exitCode = 0; });
process.once('SIGTERM', () => { shutdown(); process.exitCode = 0; });
