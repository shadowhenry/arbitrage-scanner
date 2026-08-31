import {
  scanBinaryCompleteSetArbitrage,
  type BinaryCompleteSetConfig,
} from '@arbitrage-scanner/strategies';
import {
  PolymarketAdapter,
  type DiscoveredPolymarketMarket,
} from '@arbitrage-scanner/venues/polymarket';
import { pushOpportunities, toBinaryOpportunityRow } from './push.js';

const gammaUrl = process.env.POLYMARKET_GAMMA_URL;
const clobUrl = process.env.POLYMARKET_CLOB_URL;
const polymarket = new PolymarketAdapter({
  ...(gammaUrl === undefined ? {} : { gammaUrl }),
  ...(clobUrl === undefined ? {} : { clobUrl }),
  cacheTtlMs: Number(process.env.POLYMARKET_CACHE_TTL_MS ?? '5000'),
  rateLimitRequests: Number(process.env.POLYMARKET_RATE_LIMIT_REQUESTS ?? '50'),
  rateLimitIntervalMs: Number(process.env.POLYMARKET_RATE_LIMIT_INTERVAL_MS ?? '1000'),
});

const scanConfig: BinaryCompleteSetConfig = {
  slippageBufferBps: process.env.POLYMARKET_SLIPPAGE_BUFFER_BPS ?? '50',
  maxDataAgeMs: Number(process.env.POLYMARKET_MAX_DATA_AGE_MS ?? '15000'),
};

const marketLimit = Number(process.env.POLYMARKET_SCAN_LIMIT ?? '50');
const scanIntervalMs = Number(process.env.POLYMARKET_SCAN_INTERVAL_MS ?? '15000');

let discoveredMarkets: readonly DiscoveredPolymarketMarket[] = [];
let running = false;

const reportError = (error: Error) => console.error(JSON.stringify({
  service: 'scan:polymarket', error: error.message, timestamp: new Date().toISOString(),
}));

async function refreshMarkets(): Promise<void> {
  try {
    discoveredMarkets = await polymarket.discoverMarkets({
      limit: marketLimit,
      active: true,
      closed: false,
    });
    console.error(JSON.stringify({
      service: 'scan:polymarket',
      phase: 'discover',
      marketCount: discoveredMarkets.length,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)));
  }
}

async function scanOnce(): Promise<void> {
  if (running) return;
  running = true;
  const now = new Date();
  try {
    // Fetch snapshots for all discovered markets (with concurrency limit)
    const concurrency = 5;
    const snapshots = [];
    for (let i = 0; i < discoveredMarkets.length; i += concurrency) {
      const batch = discoveredMarkets.slice(i, i + concurrency);
      const batchSnapshots = await Promise.allSettled(
        batch.map((market) => polymarket.getBinarySnapshot(market)),
      );
      for (const result of batchSnapshots) {
        if (result.status === 'fulfilled') snapshots.push(result.value);
      }
    }

    const opportunities = scanBinaryCompleteSetArbitrage(snapshots, { ...scanConfig, now });

    // Push to Dashboard API (fire-and-forget)
    const rows = opportunities.map((opp) => toBinaryOpportunityRow(opp, now));
    if (rows.length > 0) void pushOpportunities(rows);

    console.log(JSON.stringify({
      service: 'scan:polymarket',
      strategy: 'S6',
      readOnly: true,
      observedAt: now.toISOString(),
      marketCount: discoveredMarkets.length,
      snapshotCount: snapshots.length,
      opportunities,
    }));
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    running = false;
  }
}

console.error(JSON.stringify({
  service: 'scan:polymarket',
  mode: 'read-only',
  strategy: 'S6 Polymarket Binary Complete Set',
  marketLimit,
  scanIntervalMs,
  slippageBufferBps: scanConfig.slippageBufferBps,
  timestamp: new Date().toISOString(),
}));

// Initial market discovery
await refreshMarkets();

// Refresh market list every 5 minutes
const marketRefreshTimer = setInterval(() => {
  void refreshMarkets();
}, 5 * 60 * 1000);

// Scan for arbitrage opportunities at configured interval
const scanTimer = setInterval(() => {
  void scanOnce();
}, scanIntervalMs);

// Run first scan immediately
void scanOnce();

function shutdown() {
  clearInterval(marketRefreshTimer);
  clearInterval(scanTimer);
  polymarket.clearCache();
}

process.once('SIGINT', () => { shutdown(); process.exitCode = 0; });
process.once('SIGTERM', () => { shutdown(); process.exitCode = 0; });
