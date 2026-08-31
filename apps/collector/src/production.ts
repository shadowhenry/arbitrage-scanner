import { createServer } from 'node:http';
import { startJupiterCollector } from './jupiter.js';
import { SolanaNetworkCollector } from './solana-network.js';

let ready = false;
let failure: string | undefined;
const port = Number(process.env.HEALTH_PORT ?? '3001');

const server = createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ service: 'collector', ready, failure, readOnly: true }));
});

server.listen(port, '0.0.0.0');

// Jupiter DEX quote collector (optional, requires JUPITER_API_KEY)
const jupiterHandle = startJupiterCollector();

// Solana network state collector (optional, requires SOLANA_RPC_URL)
const solanaRpcUrl = process.env.SOLANA_RPC_URL;
let solanaCollector: SolanaNetworkCollector | null = null;
if (solanaRpcUrl !== undefined) {
  const solanaApiKey = process.env.SOLANA_RPC_API_KEY;
  solanaCollector = new SolanaNetworkCollector({
    rpcUrl: solanaRpcUrl,
    pollIntervalMs: Number(process.env.SOLANA_POLL_INTERVAL_MS ?? '10000'),
    ...(solanaApiKey === undefined ? {} : { apiKey: solanaApiKey }),
    onState: (state) => {
      console.log(JSON.stringify({
        service: 'collector:solana-network',
        phase: 'state',
        blockHeight: state.blockHeight,
        recentBlockTimeMs: state.recentBlockTimeMs,
        tps: state.tps,
        priorityFeeP50MicroLamports: state.priorityFeeP50MicroLamports,
        priorityFeeP95MicroLamports: state.priorityFeeP95MicroLamports,
        congestionScore: state.congestionScore,
        timestamp: state.observedAt.toISOString(),
      }));
    },
    onError: (error) => {
      console.error(JSON.stringify({
        service: 'collector:solana-network',
        phase: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      }));
    },
  });
  solanaCollector.start();
  console.log(JSON.stringify({
    service: 'collector:solana-network',
    phase: 'started',
    rpcUrl: solanaRpcUrl,
    timestamp: new Date().toISOString(),
  }));
} else {
  console.log(JSON.stringify({
    service: 'collector:solana-network',
    phase: 'skipped',
    reason: 'SOLANA_RPC_URL not set',
    timestamp: new Date().toISOString(),
  }));
}

Promise.all([import('./binance.js'), import('./bybit.js'), import('./hyperliquid.js')])
  .then(() => { ready = true; })
  .catch((error: unknown) => {
    failure = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ service: 'collector', error: failure }));
  });

function shutdown() {
  ready = false;
  jupiterHandle?.stop();
  solanaCollector?.stop();
  server.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
