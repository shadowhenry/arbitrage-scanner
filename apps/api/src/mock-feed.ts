import type { DashboardState } from './dashboard-state.js';
import type {
  DashboardMetrics,
  FundingRow,
  MarketRow,
  OpportunityRow,
  SimulationRow,
  StrategyId,
  StrategyPerformanceRow,
} from './dashboard-types.js';

const VENUES = ['Binance', 'Bybit', 'Hyperliquid', 'Jupiter', 'Raydium'] as const;
const ASSETS = [
  { symbol: 'BTC', price: 68420 },
  { symbol: 'ETH', price: 3640 },
  { symbol: 'SOL', price: 158.4 },
  { symbol: 'WIF', price: 2.31 },
  { symbol: 'BONK', price: 0.000024 },
] as const;

const STRATEGY_NAMES: Record<StrategyId, string> = {
  S1: 'Spot / Perp Basis',
  S2: 'Perp Funding',
  S3: 'CEX / CEX',
  S4: 'CEX / DEX',
  S5: 'DEX / DEX',
  S6: 'Polymarket Binary',
};

interface OpportunitySeed {
  readonly asset: string;
  readonly strategy: StrategyId;
  readonly buyVenue: string;
  readonly sellVenue: string;
  readonly baseNetEdge: number;
  readonly capacity: number;
}

const OPPORTUNITY_SEEDS: readonly OpportunitySeed[] = [
  { asset: 'BTC', strategy: 'S2', buyVenue: 'Binance Perp', sellVenue: 'Bybit Perp', baseNetEdge: 31.4, capacity: 25000 },
  { asset: 'SOL', strategy: 'S4', buyVenue: 'Jupiter', sellVenue: 'Binance Spot', baseNetEdge: 26.7, capacity: 10000 },
  { asset: 'ETH', strategy: 'S1', buyVenue: 'Bybit Spot', sellVenue: 'Hyperliquid', baseNetEdge: 22.9, capacity: 25000 },
  { asset: 'WIF', strategy: 'S5', buyVenue: 'Jupiter', sellVenue: 'Raydium', baseNetEdge: 18.4, capacity: 5000 },
  { asset: 'BTC', strategy: 'S3', buyVenue: 'Binance Spot', sellVenue: 'Bybit Spot', baseNetEdge: 14.2, capacity: 25000 },
  { asset: 'SOL', strategy: 'S2', buyVenue: 'Hyperliquid', sellVenue: 'Binance Perp', baseNetEdge: 11.8, capacity: 10000 },
  { asset: 'BONK', strategy: 'S4', buyVenue: 'Raydium', sellVenue: 'Bybit Spot', baseNetEdge: 9.7, capacity: 2500 },
  { asset: 'ETH', strategy: 'S2', buyVenue: 'Bybit Perp', sellVenue: 'Hyperliquid', baseNetEdge: 7.4, capacity: 25000 },
];

let tickCount = 0;

function noise(base: number, amplitude: number): number {
  return base + (Math.sin(tickCount / 3 + base) * amplitude) + (Math.cos(tickCount / 7 + base * 2) * amplitude * 0.5);
}

function buildOpportunity(seed: OpportunitySeed, index: number): OpportunityRow {
  const asset = ASSETS.find((a) => a.symbol === seed.asset);
  const price = asset?.price ?? 100;
  const netEdge = Math.max(1, noise(seed.baseNetEdge, 3));
  const grossEdge = netEdge + noise(4, 1.5);
  const now = Date.now();
  return {
    id: `mock-${index + 1}`,
    asset: seed.asset,
    strategy: seed.strategy,
    buyVenue: seed.buyVenue,
    sellVenue: seed.sellVenue,
    grossEdgeBps: grossEdge,
    netEdgeBps: netEdge,
    capacityUsd: seed.capacity,
    expectedProfitUsd: (seed.capacity * netEdge) / 10000,
    returnOnCapital: netEdge / 10000,
    duration: seed.strategy === 'S1' ? '8h' : seed.strategy === 'S2' ? '24h' : '< 1m',
    detectedAt: new Date(now - index * 83000).toISOString(),
    capitalBucketUsd: seed.capacity,
    buyVwap: price,
    sellVwap: price * (1 + grossEdge / 10000),
    feesUsd: seed.capacity * 0.0008,
    slippageUsd: (seed.capacity * Math.max(0, grossEdge - netEdge)) / 20000,
    fundingProfitUsd: seed.strategy === 'S1' || seed.strategy === 'S2' ? seed.capacity * 0.00042 : 0,
    history: Array.from({ length: 24 }, (_, point) => ({
      time: new Date(now - (23 - point) * 300000).toISOString(),
      edgeBps: Math.max(1, netEdge + Math.sin((point + tickCount) / 2.4) * 5 + (point % 4) * 0.7),
    })),
  };
}

function buildFunding(): readonly FundingRow[] {
  return ASSETS.map((asset, index) => {
    const binance = noise(0.5 + index * 0.1, 0.3);
    const bybit = noise(0.8 + index * 0.15, 0.4);
    const hyperliquid = noise(0.3 + index * 0.2, 0.5);
    const rates = [binance, bybit, hyperliquid];
    const max = Math.max(...rates);
    const min = Math.min(...rates);
    return {
      asset: asset.symbol,
      binance,
      bybit,
      hyperliquid,
      bestSpreadBps: Math.abs(max - min) * 100,
    };
  });
}

function buildMarkets(): readonly MarketRow[] {
  return ASSETS.flatMap((asset, assetIndex) =>
    VENUES.map((venue, venueIndex) => {
      const mid = asset.price * (1 + Math.sin(tickCount / 10 + assetIndex) * 0.002);
      const spread = 1.5 + venueIndex * 1.2 + assetIndex * 0.4 + noise(0, 0.3);
      const isDex = venue === 'Jupiter' || venue === 'Raydium';
      return {
        symbol: `${asset.symbol}/USDC`,
        venue,
        type: isDex ? 'Routing' : venue === 'Hyperliquid' ? 'Perpetual' : 'Spot',
        bid: mid * (1 - spread / 20000),
        ask: mid * (1 + spread / 20000),
        spreadBps: spread,
        depth25k: 0.72 + ((assetIndex + venueIndex + tickCount) % 3) * 0.11,
        ageMs: 80 + assetIndex * 32 + venueIndex * 19 + (tickCount % 5) * 10,
        status: assetIndex === 4 && venueIndex === 4 ? 'stale' : 'healthy',
      } as const;
    }),
  );
}

function buildSimulations(): readonly SimulationRow[] {
  return [
    {
      id: 'sim-30d',
      name: '30-day baseline',
      period: 'Aug 01 — Aug 30',
      trades: 2481 + (tickCount % 10),
      pnlUsd: 18642.4 + noise(0, 50),
      winRate: 0.714 + noise(0, 0.005),
      maxDrawdown: 0.038 + noise(0, 0.002),
      status: 'running' as const,
    },
    {
      id: 'sim-fees',
      name: 'Conservative fees',
      period: 'Jul 01 — Jul 30',
      trades: 1936,
      pnlUsd: 11204.8,
      winRate: 0.668,
      maxDrawdown: 0.052,
      status: 'completed' as const,
    },
    {
      id: 'sim-depth',
      name: 'Depth constrained',
      period: 'Jun 01 — Jun 30',
      trades: 1422,
      pnlUsd: 8736.2,
      winRate: 0.692,
      maxDrawdown: 0.031,
      status: 'completed' as const,
    },
  ];
}

function buildStrategies(): readonly StrategyPerformanceRow[] {
  const base: Array<[StrategyId, number, number, number, number]> = [
    ['S1', 392, 341, 4821, 18.4],
    ['S2', 614, 528, 7642, 24.7],
    ['S3', 281, 192, 2394, 11.2],
    ['S4', 458, 306, 3106, 15.8],
    ['S5', 147, 88, 679, 9.6],
  ];
  return base.map(([strategy, opportunities, simulatedTrades, pnlUsd, avgEdgeBps]) => ({
    strategy,
    name: STRATEGY_NAMES[strategy],
    opportunities: opportunities + (tickCount % 5),
    simulatedTrades,
    pnlUsd: pnlUsd + noise(0, 20),
    avgEdgeBps: Math.max(1, noise(avgEdgeBps, 1)),
    utilization: 0.5 + (avgEdgeBps / 50) + noise(0, 0.02),
  }));
}

function buildMetrics(opportunities: readonly OpportunityRow[]): DashboardMetrics {
  const sortedEdges = [...opportunities].map((o) => o.netEdgeBps).sort((a, b) => a - b);
  const median = sortedEdges[Math.floor(sortedEdges.length / 2)] ?? 0;
  const best = opportunities[0];
  return {
    opportunitiesToday: 184 + (tickCount % 20),
    simulatedProfitToday: 1842.62 + noise(0, 30),
    bestOpportunity: best !== undefined
      ? `${best.asset} · ${best.strategy} · ${best.netEdgeBps.toFixed(1)} bps`
      : '—',
    medianNetEdgeBps: median,
    capitalUtilization: 0.684 + noise(0, 0.01),
  };
}

/**
 * Starts the mock data feed, periodically updating the dashboard state
 * with simulated real-time data. Used when no real scanner is connected.
 */
export function startMockFeed(state: DashboardState, intervalMs = 3000): () => void {
  // Initial full snapshot
  const opportunities = OPPORTUNITY_SEEDS.map((seed, index) => buildOpportunity(seed, index));
  state.setSnapshot({
    metrics: buildMetrics(opportunities),
    opportunities,
    funding: buildFunding(),
    markets: buildMarkets(),
    simulations: buildSimulations(),
    strategies: buildStrategies(),
  });

  const timer = setInterval(() => {
    tickCount += 1;
    // Update opportunities (edge values change over time)
    const opportunities = OPPORTUNITY_SEEDS.map((seed, index) => buildOpportunity(seed, index));
    for (const opp of opportunities) {
      state.upsertOpportunity(opp);
    }
    // Update other data sections
    state.updateFunding(buildFunding());
    state.updateMarkets(buildMarkets());
    state.updateSimulations(buildSimulations());
    state.updateStrategies(buildStrategies());
    state.updateMetrics(buildMetrics(opportunities));
  }, intervalMs);

  return () => clearInterval(timer);
}
