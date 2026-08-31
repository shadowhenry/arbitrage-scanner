import type { DashboardSnapshot, OpportunityRow, StrategyId } from './types.js';

const now = Date.now();
const venues = ['Binance', 'Bybit', 'Hyperliquid', 'Jupiter', 'Raydium'];
const seeds: readonly [string, StrategyId, string, string, number, number, number][] = [
  ['BTC', 'S2', 'Binance Perp', 'Bybit Perp', 42.8, 31.4, 25_000],
  ['SOL', 'S4', 'Jupiter', 'Binance Spot', 38.2, 26.7, 10_000],
  ['ETH', 'S1', 'Bybit Spot', 'Hyperliquid', 34.5, 22.9, 25_000],
  ['WIF', 'S5', 'Jupiter', 'Raydium', 29.1, 18.4, 5_000],
  ['BTC', 'S3', 'Binance Spot', 'Bybit Spot', 23.4, 14.2, 25_000],
  ['SOL', 'S2', 'Hyperliquid', 'Binance Perp', 19.7, 11.8, 10_000],
  ['BONK', 'S4', 'Raydium', 'Bybit Spot', 18.5, 9.7, 2_500],
  ['ETH', 'S2', 'Bybit Perp', 'Hyperliquid', 15.3, 7.4, 25_000],
];

export const demoOpportunities: readonly OpportunityRow[] = seeds.map((seed, index) => {
  const [asset, strategy, buyVenue, sellVenue, gross, net, capacity] = seed;
  const price = asset === 'BTC' ? 68_420 : asset === 'ETH' ? 3_640 : asset === 'SOL' ? 158.4 : asset === 'WIF' ? 2.31 : 0.000024;
  return {
    id: `demo-${index + 1}`, asset, strategy, buyVenue, sellVenue,
    grossEdgeBps: gross, netEdgeBps: net, capacityUsd: capacity,
    expectedProfitUsd: capacity * net / 10_000,
    returnOnCapital: net / 10_000,
    duration: strategy === 'S1' ? '8h' : strategy === 'S2' ? '24h' : '< 1m',
    detectedAt: new Date(now - index * 83_000).toISOString(), capitalBucketUsd: capacity,
    buyVwap: price, sellVwap: price * (1 + gross / 10_000),
    feesUsd: capacity * 0.0008, slippageUsd: capacity * Math.max(0, gross - net) / 20_000,
    fundingProfitUsd: strategy === 'S1' || strategy === 'S2' ? capacity * 0.00042 : 0,
    history: Array.from({ length: 24 }, (_, point) => ({
      time: new Date(now - (23 - point) * 300_000).toISOString(),
      edgeBps: Math.max(1, net + Math.sin(point / 2.4) * 5 + (point % 4) * 0.7),
    })),
  };
});

export const demoSnapshot: DashboardSnapshot = {
  metrics: {
    opportunitiesToday: 184,
    simulatedProfitToday: 1_842.62,
    bestOpportunity: 'BTC · S2 · 31.4 bps',
    medianNetEdgeBps: 13.8,
    capitalUtilization: 0.684,
  },
  opportunities: demoOpportunities,
  funding: [
    { asset: 'BTC', binance: 0.82, bybit: 1.24, hyperliquid: -0.31, bestSpreadBps: 1.55 },
    { asset: 'ETH', binance: 0.44, bybit: -0.18, hyperliquid: 0.91, bestSpreadBps: 1.09 },
    { asset: 'SOL', binance: -0.23, bybit: 0.68, hyperliquid: 1.13, bestSpreadBps: 1.36 },
    { asset: 'WIF', binance: 1.88, bybit: 2.14, hyperliquid: 0.72, bestSpreadBps: 1.42 },
    { asset: 'BONK', binance: 0.11, bybit: -0.42, hyperliquid: 0.36, bestSpreadBps: 0.78 },
  ],
  markets: ['BTC', 'ETH', 'SOL', 'WIF', 'BONK'].flatMap((symbol, assetIndex) => venues.map((venue, venueIndex) => {
    const mid = [68_420, 3_640, 158.4, 2.31, 0.000024][assetIndex] ?? 1;
    const spread = 1.5 + venueIndex * 1.2 + assetIndex * 0.4;
    return {
      symbol: `${symbol}/USDC`, venue,
      type: venue === 'Jupiter' || venue === 'Raydium' ? 'Routing' : venue === 'Hyperliquid' ? 'Perpetual' : 'Spot',
      bid: mid * (1 - spread / 20_000), ask: mid * (1 + spread / 20_000),
      spreadBps: spread, depth25k: 0.72 + ((assetIndex + venueIndex) % 3) * 0.11,
      ageMs: 80 + assetIndex * 32 + venueIndex * 19,
      status: assetIndex === 4 && venueIndex === 4 ? 'stale' : 'healthy',
    } as const;
  })),
  simulations: [
    { id: 'sim-30d', name: '30-day baseline', period: 'Aug 01 — Aug 30', trades: 2_481, pnlUsd: 18_642.4, winRate: 0.714, maxDrawdown: 0.038, status: 'running' },
    { id: 'sim-fees', name: 'Conservative fees', period: 'Jul 01 — Jul 30', trades: 1_936, pnlUsd: 11_204.8, winRate: 0.668, maxDrawdown: 0.052, status: 'completed' },
    { id: 'sim-depth', name: 'Depth constrained', period: 'Jun 01 — Jun 30', trades: 1_422, pnlUsd: 8_736.2, winRate: 0.692, maxDrawdown: 0.031, status: 'completed' },
  ],
  strategies: [
    { strategy: 'S1', name: 'Spot / Perp Basis', opportunities: 392, simulatedTrades: 341, pnlUsd: 4_821, avgEdgeBps: 18.4, utilization: 0.81 },
    { strategy: 'S2', name: 'Perp Funding', opportunities: 614, simulatedTrades: 528, pnlUsd: 7_642, avgEdgeBps: 24.7, utilization: 0.88 },
    { strategy: 'S3', name: 'CEX / CEX', opportunities: 281, simulatedTrades: 192, pnlUsd: 2_394, avgEdgeBps: 11.2, utilization: 0.64 },
    { strategy: 'S4', name: 'CEX / DEX', opportunities: 458, simulatedTrades: 306, pnlUsd: 3_106, avgEdgeBps: 15.8, utilization: 0.71 },
    { strategy: 'S5', name: 'DEX / DEX', opportunities: 147, simulatedTrades: 88, pnlUsd: 679, avgEdgeBps: 9.6, utilization: 0.46 },
  ],
};
