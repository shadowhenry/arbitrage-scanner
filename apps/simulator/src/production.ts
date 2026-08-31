import { createServer } from 'node:http';
import { healthy } from '@arbitrage-scanner/core';

const port = Number(process.env.HEALTH_PORT ?? '3003');
const server = createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ...healthy('simulator'), readOnly: true }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ service: 'simulator', status: 'ready', port, readOnly: true }));
});

function shutdown() {
  server.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
