import {
  scanSpotPerpBasisArbitrage,
  type SpotMarketSnapshot,
  type SpotVenueId,
} from '@arbitrage-scanner/strategies';
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
  BinanceSpotAdapter,
  type BinanceSpotState,
} from '@arbitrage-scanner/venues/binance';
import {
  BybitLinearAdapter,
  type BybitLinearState,
  type BybitSymbol,
} from '@arbitrage-scanner/venues/bybit';
import {
  BybitSpotAdapter,
  type BybitSpotState,
} from '@arbitrage-scanner/venues/bybit';
import {
  HyperliquidAdapter,
  type HyperliquidPerpState,
} from '@arbitrage-scanner/venues/hyperliquid';

const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
const binanceSymbols = symbols as readonly BinanceSymbol[];
const bybitSymbols = symbols as readonly BybitSymbol[];

const spotSnapshots = new Map<string, SpotMarketSnapshot>();
const perpSnapshots = new Map<string, PerpMarketSnapshot>();

function recordSpot(venueId: SpotVenueId, state: BinanceSpotState | BybitSpotState) {
  if (state.orderBook === undefined || state.stale) return;
  const market = state.quote;
  spotSnapshots.set(`${venueId}:${market.baseAsset.symbol}`, { venueId, market, orderBook: state.orderBook });
}

function recordPerp(venueId: FundingVenueId, state: BinanceFuturesState | BybitLinearState | HyperliquidPerpState) {
  if (state.orderBook === undefined || state.stale) return;
  const market = state.market;
  perpSnapshots.set(`${venueId}:${market.baseAsset.symbol}`, { venueId, market, orderBook: state.orderBook });
}

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'scan:basis', error: error.message, timestamp: new Date().toISOString(),
}));

// Spot adapters
const binanceSpot = new BinanceSpotAdapter({
  symbols: binanceSymbols,
  onState: (_symbol, state) => recordSpot('binance', state),
  onError: reportError,
});
const bybitSpot = new BybitSpotAdapter({
  symbols: bybitSymbols,
  onState: (_symbol, state) => recordSpot('bybit', state),
  onError: reportError,
});

// Perp adapters (reuse same pattern as funding scanner)
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

const spotTakerFees = {
  binance: process.env.BINANCE_SPOT_TAKER_FEE ?? '0.001',
  bybit: process.env.BYBIT_SPOT_TAKER_FEE ?? '0.001',
};
const perpTakerFees = {
  'binance-usdm': process.env.BINANCE_FUTURES_TAKER_FEE ?? '0.0005',
  'bybit-linear': process.env.BYBIT_LINEAR_TAKER_FEE ?? '0.00055',
  hyperliquid: process.env.HYPERLIQUID_TAKER_FEE ?? '0.00045',
};

console.error(JSON.stringify({
  service: 'scan:basis',
  mode: 'read-only',
  spotTakerFeeAssumptions: spotTakerFees,
  perpTakerFeeAssumptions: perpTakerFees,
  note: 'Override fee assumptions with venue-specific environment variables.',
}));

const scanTimer = setInterval(() => {
  const now = new Date();
  const basisOpportunities = scanSpotPerpBasisArbitrage(
    [...spotSnapshots.values()],
    [...perpSnapshots.values()],
    {
      maxCapitalUsd: process.env.BASIS_SCAN_MAX_CAPITAL_USD ?? '25000',
      spotTakerFees,
      perpTakerFees,
      maxDataAgeMs: 10_000,
      now,
    },
  );

  // Also run funding scan for cross-reference (S2)
  const fundingOpportunities = scanPerpFundingArbitrage([...perpSnapshots.values()], {
    maxCapitalUsd: process.env.FUNDING_SCAN_MAX_CAPITAL_USD ?? '25000',
    takerFees: perpTakerFees,
    maxDataAgeMs: 10_000,
    now,
  });

  console.log(JSON.stringify({
    service: 'scan:basis',
    readOnly: true,
    observedAt: now.toISOString(),
    spotMarketCount: spotSnapshots.size,
    perpMarketCount: perpSnapshots.size,
    s1BasisOpportunities: basisOpportunities,
    s2FundingOpportunities: fundingOpportunities,
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
