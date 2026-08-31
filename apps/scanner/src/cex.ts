import type { Asset, OrderBook, Venue } from '@arbitrage-scanner/core';
import {
  scanArbitrageGraph,
  type GraphArbitrageOpportunity,
  type OrderBookGraphNode,
} from '@arbitrage-scanner/strategies';
import { pushOpportunities, toOpportunityRow } from './push.js';
import {
  BinanceFuturesAdapter,
  BinanceSpotAdapter,
  type BinanceFuturesState,
  type BinanceSpotState,
  type BinanceSymbol,
} from '@arbitrage-scanner/venues/binance';
import {
  BybitLinearAdapter,
  BybitSpotAdapter,
  type BybitLinearState,
  type BybitSpotState,
  type BybitSymbol,
} from '@arbitrage-scanner/venues/bybit';
import {
  HyperliquidAdapter,
  type HyperliquidPerpState,
} from '@arbitrage-scanner/venues/hyperliquid';

const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
const binanceSymbols = symbols as readonly BinanceSymbol[];
const bybitSymbols = symbols as readonly BybitSymbol[];

const VENUES: Record<string, Venue> = {
  'binance-spot': { id: 'binance-spot', name: 'Binance Spot', kind: 'cex' },
  'binance-usdm': { id: 'binance-usdm', name: 'Binance USDⓈ-M Futures', kind: 'cex' },
  'bybit-spot': { id: 'bybit-spot', name: 'Bybit Spot', kind: 'cex' },
  'bybit-linear': { id: 'bybit-linear', name: 'Bybit Linear', kind: 'cex' },
  hyperliquid: { id: 'hyperliquid', name: 'Hyperliquid', kind: 'cex' },
};

const TAKER_FEES: Record<string, string> = {
  'binance-spot': process.env.BINANCE_SPOT_TAKER_FEE ?? '0.001',
  'binance-usdm': process.env.BINANCE_FUTURES_TAKER_FEE ?? '0.0005',
  'bybit-spot': process.env.BYBIT_SPOT_TAKER_FEE ?? '0.001',
  'bybit-linear': process.env.BYBIT_LINEAR_TAKER_FEE ?? '0.00055',
  hyperliquid: process.env.HYPERLIQUID_TAKER_FEE ?? '0.00045',
};

interface MarketState {
  readonly venueId: string;
  readonly marketType: 'spot' | 'perpetual';
  readonly baseAsset: Asset;
  readonly quoteAsset: Asset;
  readonly orderBook: OrderBook;
  readonly observedAt: Date;
  readonly hourlyFundingRate?: string;
  readonly fundingObservedAt?: Date;
}

const markets = new Map<string, MarketState>();

function recordSpot(venueId: string, state: BinanceSpotState | BybitSpotState) {
  if (state.orderBook === undefined || state.stale) return;
  const key = `${venueId}:${state.quote.baseAsset.symbol}`;
  markets.set(key, {
    venueId,
    marketType: 'spot',
    baseAsset: state.quote.baseAsset,
    quoteAsset: state.quote.quoteAsset,
    orderBook: state.orderBook,
    observedAt: state.orderBook.observedAt,
  });
}

function recordPerp(venueId: string, state: BinanceFuturesState | BybitLinearState | HyperliquidPerpState) {
  if (state.orderBook === undefined || state.stale) return;
  const key = `${venueId}:${state.market.baseAsset.symbol}`;
  const hourlyFundingRate = state.market.fundingRate?.hourlyRate.toString();
  const fundingObservedAt = state.market.fundingRate?.observedAt;
  markets.set(key, {
    venueId,
    marketType: 'perpetual',
    baseAsset: state.market.baseAsset,
    quoteAsset: state.market.quoteAsset,
    orderBook: state.orderBook,
    observedAt: state.orderBook.observedAt,
    ...(hourlyFundingRate === undefined ? {} : { hourlyFundingRate }),
    ...(fundingObservedAt === undefined ? {} : { fundingObservedAt }),
  });
}

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'scan:cex', error: error.message, timestamp: new Date().toISOString(),
}));

// Spot adapters
const binanceSpot = new BinanceSpotAdapter({
  symbols: binanceSymbols,
  onState: (_symbol, state) => recordSpot('binance-spot', state),
  onError: reportError,
});
const bybitSpot = new BybitSpotAdapter({
  symbols: bybitSymbols,
  onState: (_symbol, state) => recordSpot('bybit-spot', state),
  onError: reportError,
});

// Perp adapters
const binanceFutures = new BinanceFuturesAdapter({
  symbols: binanceSymbols,
  onState: (_symbol, state) => recordPerp('binance-usdm', state),
  onError: reportError,
});
const bybitLinear = new BybitLinearAdapter({
  symbols: bybitSymbols,
  onState: (_symbol, state) => recordPerp('bybit-linear', state),
  onError: reportError,
});
const hyperliquid = new HyperliquidAdapter({
  perpAssets: ['BTC', 'ETH', 'SOL'],
  onState: (_coin, state) => {
    if (state.kind === 'perpetual') recordPerp('hyperliquid', state);
  },
  onError: reportError,
});

function buildNodes(): OrderBookGraphNode[] {
  const nodes: OrderBookGraphNode[] = [];
  for (const market of markets.values()) {
    const venue = VENUES[market.venueId];
    if (venue === undefined) continue;
    nodes.push({
      id: `${market.venueId}:${market.baseAsset.symbol}`,
      venue,
      marketType: market.marketType,
      baseAsset: market.baseAsset,
      quoteAsset: market.quoteAsset,
      takerFeeRate: TAKER_FEES[market.venueId] ?? '0.001',
      observedAt: market.observedAt,
      executionKind: 'orderbook',
      orderBook: market.orderBook,
      ...(market.hourlyFundingRate === undefined ? {} : { hourlyFundingRate: market.hourlyFundingRate }),
      ...(market.fundingObservedAt === undefined ? {} : { fundingObservedAt: market.fundingObservedAt }),
    });
  }
  return nodes;
}

console.error(JSON.stringify({
  service: 'scan:cex',
  mode: 'read-only',
  strategies: ['S1 Spot/Perp Basis', 'S2 Perp/Perp Funding', 'S3 CEX/CEX Spot'],
  takerFeeAssumptions: TAKER_FEES,
}));

const scanTimer = setInterval(() => {
  const now = new Date();
  const nodes = buildNodes();
  const allOpportunities = scanArbitrageGraph(nodes, {
    maxDataAgeMs: 10_000,
    fundingHorizonHours: 8,
    requirePositiveProfit: true,
    now,
  });

  const byStrategy: Record<string, GraphArbitrageOpportunity[]> = {
    S1: [], S2: [], S3: [],
  };
  for (const opp of allOpportunities) {
    const list = byStrategy[opp.strategyId];
    if (list !== undefined) list.push(opp);
  }

  // Push detected opportunities to the Dashboard API (fire-and-forget).
  const rows = allOpportunities.map((opp) => {
    const vwap = opp.buyCostUsd.plus(opp.sellProceedsUsd)
      .div(opp.executableBaseQuantity.mul(2))
      .toNumber();
    return toOpportunityRow(opp, vwap, vwap, now);
  });
  if (rows.length > 0) void pushOpportunities(rows);

  console.log(JSON.stringify({
    service: 'scan:cex',
    readOnly: true,
    observedAt: now.toISOString(),
    marketCount: markets.size,
    nodeCount: nodes.length,
    s1SpotPerpBasis: byStrategy.S1,
    s2PerpPerpFunding: byStrategy.S2,
    s3CexCexSpot: byStrategy.S3,
  }));
}, 5_000);

function shutdown() {
  clearInterval(scanTimer);
  binanceSpot.stop();
  bybitSpot.stop();
  binanceFutures.stop();
  bybitLinear.stop();
  hyperliquid.stop();
}

process.once('SIGINT', () => { shutdown(); process.exitCode = 0; });
process.once('SIGTERM', () => { shutdown(); process.exitCode = 0; });

binanceSpot.start();
bybitSpot.start();
binanceFutures.start();
bybitLinear.start();
await hyperliquid.start();
