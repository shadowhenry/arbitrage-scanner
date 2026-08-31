import { HyperliquidAdapter } from '@arbitrage-scanner/venues/hyperliquid';

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'collector:hyperliquid', error: error.message, timestamp: new Date().toISOString(),
}));

const adapter = new HyperliquidAdapter({
  perpAssets: ['BTC', 'ETH', 'SOL'],
  spotAssets: ['BTC', 'ETH', 'SOL'],
  onState: (coin, state) => console.log(JSON.stringify({
    venue: 'hyperliquid', coin, state,
  })),
  onError: reportError,
});

function shutdown() {
  adapter.stop();
}

process.once('SIGINT', () => { shutdown(); process.exitCode = 0; });
process.once('SIGTERM', () => { shutdown(); process.exitCode = 0; });

await adapter.start();

