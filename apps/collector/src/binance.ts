import {
  BinanceFuturesAdapter,
  BinanceSpotAdapter,
  type BinanceFuturesState,
  type BinanceSpotState,
  type BinanceSymbol,
} from '@arbitrage-scanner/venues/binance';

const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const satisfies readonly BinanceSymbol[];
const states = new Map<string, BinanceSpotState | BinanceFuturesState>();

function print(kind: 'spot' | 'perpetual', symbol: BinanceSymbol, state: BinanceSpotState | BinanceFuturesState) {
  states.set(`${kind}:${symbol}`, state);
  console.log(JSON.stringify({ kind, symbol, state }));
}

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'collector:binance', error: error.message, timestamp: new Date().toISOString(),
}));

const spot = new BinanceSpotAdapter({
  symbols,
  onState: (symbol, state) => print('spot', symbol, state),
  onError: reportError,
});
const futures = new BinanceFuturesAdapter({
  symbols,
  onState: (symbol, state) => print('perpetual', symbol, state),
  onError: reportError,
});

function shutdown() {
  spot.stop();
  futures.stop();
}

process.once('SIGINT', () => { shutdown(); process.exitCode = 0; });
process.once('SIGTERM', () => { shutdown(); process.exitCode = 0; });

spot.start();
futures.start();

