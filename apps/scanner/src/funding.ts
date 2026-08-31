import {
  scanPerpFundingArbitrage,
  type FundingVenueId,
  type PerpMarketSnapshot,
} from '@arbitrage-scanner/strategies';
import {
  BinanceFuturesAdapter,
  type BinanceFuturesState,
  type BinanceSymbol,
} from '@arbitrage-scanner/venues/binance';
import {
  BybitLinearAdapter,
  type BybitLinearState,
  type BybitSymbol,
} from '@arbitrage-scanner/venues/bybit';
import {
  HyperliquidAdapter,
  type HyperliquidPerpState,
} from '@arbitrage-scanner/venues/hyperliquid';

const binanceSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const satisfies readonly BinanceSymbol[];
const bybitSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const satisfies readonly BybitSymbol[];
const snapshots = new Map<string, PerpMarketSnapshot>();

function record(venueId: FundingVenueId, state: BinanceFuturesState | BybitLinearState | HyperliquidPerpState) {
  if (state.orderBook === undefined || state.stale) return;
  const market = 'market' in state ? state.market : undefined;
  if (market === undefined) return;
  snapshots.set(`${venueId}:${market.baseAsset.symbol}`, { venueId, market, orderBook: state.orderBook });
}

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'scan:funding', error: error.message, timestamp: new Date().toISOString(),
}));

const binance = new BinanceFuturesAdapter({
  symbols: binanceSymbols,
  onState: (_symbol, state) => record('binance-usdm', state),
  onError: reportError,
});
const bybit = new BybitLinearAdapter({
  symbols: bybitSymbols,
  onState: (_symbol, state) => record('bybit-linear', state),
  onError: reportError,
});
const hyperliquid = new HyperliquidAdapter({
  perpAssets: ['BTC', 'ETH', 'SOL'],
  onState: (_coin, state) => {
    if (state.kind === 'perpetual') record('hyperliquid', state);
  },
  onError: reportError,
});

const takerFees = {
  'binance-usdm': process.env.BINANCE_FUTURES_TAKER_FEE ?? '0.0005',
  'bybit-linear': process.env.BYBIT_LINEAR_TAKER_FEE ?? '0.00055',
  hyperliquid: process.env.HYPERLIQUID_TAKER_FEE ?? '0.00045',
};

console.error(JSON.stringify({
  service: 'scan:funding',
  mode: 'read-only',
  takerFeeAssumptions: takerFees,
  note: 'Override fee assumptions with venue-specific environment variables.',
}));

const scanTimer = setInterval(() => {
  const opportunities = scanPerpFundingArbitrage([...snapshots.values()], {
    maxCapitalUsd: process.env.FUNDING_SCAN_MAX_CAPITAL_USD ?? '25000',
    takerFees,
    maxDataAgeMs: 10_000,
  });
  console.log(JSON.stringify({
    strategy: 'S2',
    readOnly: true,
    observedAt: new Date().toISOString(),
    marketCount: snapshots.size,
    opportunities,
  }));
}, 5_000);

function shutdown() {
  clearInterval(scanTimer);
  binance.stop();
  bybit.stop();
  hyperliquid.stop();
}

process.once('SIGINT', () => { shutdown(); process.exitCode = 0; });
process.once('SIGTERM', () => { shutdown(); process.exitCode = 0; });

binance.start();
bybit.start();
await hyperliquid.start();

