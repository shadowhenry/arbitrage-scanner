import { buildApp } from './app.js';
import { startMockFeed } from './mock-feed.js';

const { app, dashboardState } = await buildApp();
const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? '0.0.0.0';

// Start mock data feed unless explicitly disabled.
// Set MOCK_FEED=0 to disable when real scanner data is being pushed.
const enableMockFeed = process.env.MOCK_FEED !== '0';
if (enableMockFeed) {
  const intervalMs = Number(process.env.MOCK_FEED_INTERVAL_MS ?? 3000);
  startMockFeed(dashboardState, intervalMs);
  console.error(JSON.stringify({
    service: 'api',
    phase: 'mock-feed-started',
    intervalMs,
    note: 'Set MOCK_FEED=0 to disable mock data when real scanners are connected.',
    timestamp: new Date().toISOString(),
  }));
}

await app.listen({ port, host });

console.error(JSON.stringify({
  service: 'api',
  phase: 'listening',
  port,
  host,
  websocket: `ws://localhost:${port}/ws`,
  timestamp: new Date().toISOString(),
}));
