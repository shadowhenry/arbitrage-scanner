import { createServer } from 'node:http';

let ready = false;
let failure: string | undefined;
const port = Number(process.env.HEALTH_PORT ?? '3002');

const server = createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    service: 'scanner',
    ready,
    failure,
    readOnly: true,
    strategies: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  }));
});

server.listen(port, '0.0.0.0');

// Start all strategy scanners via dynamic import.
// Each module starts its own adapter connections and scan loops.
const scannerModules = [
  './cex.js',       // S1 Spot/Perp Basis, S2 Perp/Perp Funding, S3 CEX/CEX Spot
  './cex-dex.js',   // S4 CEX/DEX (Binance Spot ↔ Jupiter)
  './dex-dex.js',   // S5 DEX/DEX (Jupiter ↔ Raydium)
  './polymarket.js', // S6 Polymarket Binary Complete Set
];

console.error(JSON.stringify({
  service: 'scanner',
  phase: 'starting',
  modules: scannerModules,
  timestamp: new Date().toISOString(),
}));

Promise.all(scannerModules.map((mod) => import(mod)))
  .then(() => {
    ready = true;
    console.error(JSON.stringify({
      service: 'scanner',
      phase: 'ready',
      strategies: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
      timestamp: new Date().toISOString(),
    }));
  })
  .catch((error: unknown) => {
    failure = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ service: 'scanner', phase: 'error', error: failure }));
  });

function shutdown() {
  ready = false;
  server.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
