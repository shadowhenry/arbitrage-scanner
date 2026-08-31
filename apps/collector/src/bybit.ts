import {
  BybitLinearAdapter,
  BybitSpotAdapter,
  type BybitLinearState,
  type BybitSpotState,
  type BybitSymbol,
} from '@arbitrage-scanner/venues/bybit';

const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const satisfies readonly BybitSymbol[];

function print(
  kind: 'spot' | 'linear',
  symbol: BybitSymbol,
  state: BybitSpotState | BybitLinearState,
) {
  console.log(JSON.stringify({ venue: 'bybit', kind, symbol, state }));
}

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'collector:bybit', error: error.message, timestamp: new Date().toISOString(),
}));

const spot = new BybitSpotAdapter({
  symbols,
  onState: (symbol, state) => print('spot', symbol, state),
  onError: reportError,
});
const linear = new BybitLinearAdapter({
  symbols,
  onState: (symbol, state) => print('linear', symbol, state),
  onError: reportError,
});

function shutdown() {
  spot.stop();
  linear.stop();
}

process.once('SIGINT', () => { shutdown(); process.exitCode = 0; });
process.once('SIGTERM', () => { shutdown(); process.exitCode = 0; });

spot.start();
linear.start();

