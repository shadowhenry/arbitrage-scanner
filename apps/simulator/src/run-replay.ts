/**
 * Shadow simulation replay runner.
 *
 * Usage:
 *   # From database (requires PostgreSQL with historical data)
 *   pnpm --filter @arbitrage-scanner/simulator replay
 *
 *   # Synthetic data (for testing without database)
 *   SYNTHETIC=1 pnpm --filter @arbitrage-scanner/simulator replay
 *
 * Environment variables:
 *   DATABASE_URL       - PostgreSQL connection string (required for DB mode)
 *   REPLAY_START       - Start time ISO string (default: 30 days ago)
 *   REPLAY_END         - End time ISO string (default: now)
 *   BINANCE_MARKET_ID  - Market ID for Binance SOL/USDT (default: auto-detect)
 *   JUPITER_MARKET_ID  - Market ID for Jupiter SOL/USDC (default: auto-detect)
 *   INITIAL_INVENTORY  - Initial inventory USD value (default: 20000)
 *   SOL_PRICE          - SOL price in USD for gas calculations (default: 150)
 *   GAS_PRIORITY_FEE   - Priority fee in micro-lamports (default: 50000)
 *   MIN_PROFIT         - Minimum gross profit threshold in USD (default: 0.01)
 *   RANDOM_SEED        - Random seed for deterministic runs (default: 42)
 *   SYNTHETIC          - Set to "1" to use synthetic test data
 *   OUTPUT_FORMAT      - "markdown" | "html" | "both" (default: both)
 *   OUTPUT_DIR         - Directory for output files (default: ./reports)
 */

import { Decimal } from '@arbitrage-scanner/core';
import { ReplayEngine } from './replay-engine.js';
import { HistoricalDataLoader, generateSyntheticEvents } from './data-loader.js';
import {
  evaluateGoNoGo,
  generateHtmlReport,
  generateMarkdownReport,
  DEFAULT_GO_NO_GO_THRESHOLDS,
} from './report-generator.js';
import type { ReplayConfig } from './replay-types.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface RunnerConfig {
  readonly startTime: Date;
  readonly endTime: Date;
  readonly binanceMarketId: number;
  readonly jupiterMarketId: number;
  readonly initialInventoryUsd: number;
  readonly solPriceUsd: string;
  readonly gasPriorityFeeMicroLamports: number;
  readonly minProfitThresholdUsd: string;
  readonly randomSeed: number;
  readonly synthetic: boolean;
  readonly outputFormat: 'markdown' | 'html' | 'both';
  readonly outputDir: string;
}

function parseConfig(): RunnerConfig {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    startTime: process.env.REPLAY_START !== undefined
      ? new Date(process.env.REPLAY_START)
      : thirtyDaysAgo,
    endTime: process.env.REPLAY_END !== undefined
      ? new Date(process.env.REPLAY_END)
      : now,
    binanceMarketId: Number(process.env.BINANCE_MARKET_ID ?? '1'),
    jupiterMarketId: Number(process.env.JUPITER_MARKET_ID ?? '2'),
    initialInventoryUsd: Number(process.env.INITIAL_INVENTORY ?? '20000'),
    solPriceUsd: process.env.SOL_PRICE ?? '150',
    gasPriorityFeeMicroLamports: Number(process.env.GAS_PRIORITY_FEE ?? '50000'),
    minProfitThresholdUsd: process.env.MIN_PROFIT ?? '0.01',
    randomSeed: Number(process.env.RANDOM_SEED ?? '42'),
    synthetic: process.env.SYNTHETIC === '1',
    outputFormat: (process.env.OUTPUT_FORMAT as 'markdown' | 'html' | 'both') ?? 'both',
    outputDir: process.env.OUTPUT_DIR ?? './reports',
  };
}

function buildReplayConfig(config: RunnerConfig): ReplayConfig {
  const halfInventory = config.initialInventoryUsd / 4;
  const solQuantity = halfInventory / Number(config.solPriceUsd);

  return {
    initialInventory: {
      cexUsdc: new Decimal(halfInventory),
      cexSol: new Decimal(solQuantity),
      chainUsdc: new Decimal(halfInventory),
      chainSol: new Decimal(solQuantity),
    },
    solPriceUsd: config.solPriceUsd,
    minProfitThresholdUsd: config.minProfitThresholdUsd,
    gasPriorityFeeMicroLamports: config.gasPriorityFeeMicroLamports,
    randomSeed: config.randomSeed,
  };
}

async function ensureOutputDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory may already exist
  }
}

async function runReplay(): Promise<void> {
  const config = parseConfig();
  const replayConfig = buildReplayConfig(config);

  console.log(JSON.stringify({
    service: 'simulator:replay',
    mode: config.synthetic ? 'synthetic' : 'database',
    startTime: config.startTime.toISOString(),
    endTime: config.endTime.toISOString(),
    initialInventoryUsd: config.initialInventoryUsd,
    solPriceUsd: config.solPriceUsd,
    gasPriorityFeeMicroLamports: config.gasPriorityFeeMicroLamports,
    randomSeed: config.randomSeed,
    timestamp: new Date().toISOString(),
  }));

  // Load events
  let events;
  let summary;

  if (config.synthetic) {
    events = generateSyntheticEvents(
      config.startTime,
      config.endTime,
      5000, // 5-second intervals
      {
        binanceMidPrice: Number(config.solPriceUsd),
        jupiterPremiumBps: 25,
        volatilityBps: 8,
      },
    );
    summary = {
      orderBookCount: events.filter((e) => e.type === 'binance-orderbook').length,
      dexQuoteCount: events.filter((e) => e.type === 'jupiter-quote').length,
      totalEvents: events.length,
      startTime: config.startTime,
      endTime: config.endTime,
    };
  } else {
    // Database mode requires pg
    const { Pool } = await import('pg');
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL environment variable is required for database mode');
    }
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const loader = new HistoricalDataLoader(pool, {
        startTime: config.startTime,
        endTime: config.endTime,
        binanceMarketId: config.binanceMarketId,
        jupiterMarketId: config.jupiterMarketId,
      });
      const result = await loader.loadEvents();
      events = result.events;
      summary = result.summary;
    } finally {
      await pool.end();
    }
  }

  console.log(JSON.stringify({
    service: 'simulator:replay',
    phase: 'data-loaded',
    ...summary,
    timestamp: new Date().toISOString(),
  }));

  if (events.length === 0) {
    console.warn(JSON.stringify({
      service: 'simulator:replay',
      warning: 'No events loaded. Check data source and time range.',
    }));
    return;
  }

  // Run replay
  const engine = new ReplayEngine(events, replayConfig);
  const metrics = engine.run();

  console.log(JSON.stringify({
    service: 'simulator:replay',
    phase: 'replay-complete',
    totalTrades: metrics.totalTrades,
    successfulTrades: metrics.successfulTrades,
    failedTrades: metrics.failedTrades,
    winRate: metrics.winRate.toString(),
    totalRealizedPnlUsd: metrics.totalRealizedPnlUsd.toString(),
    averagePnlUsd: metrics.averagePnlUsd.toString(),
    medianPnlUsd: metrics.medianPnlUsd.toString(),
    maxDrawdownUsd: metrics.maxDrawdownUsd.toString(),
    maxDrawdownPct: metrics.maxDrawdownPct.toString(),
    totalGasUsd: metrics.totalGasUsd.toString(),
    gasToProfitRatio: metrics.gasToProfitRatio.toString(),
    averageLatencyMs: metrics.averageLatencyMs,
    timestamp: new Date().toISOString(),
  }));

  // Evaluate go/no-go
  const goNoGo = evaluateGoNoGo(metrics, DEFAULT_GO_NO_GO_THRESHOLDS);

  console.log(JSON.stringify({
    service: 'simulator:replay',
    phase: 'go-no-go-evaluation',
    passed: goNoGo.passed,
    summary: goNoGo.summary,
    checks: goNoGo.checks.map((check) => ({
      name: check.name,
      passed: check.passed,
      actual: check.actual,
      threshold: check.threshold,
    })),
    timestamp: new Date().toISOString(),
  }));

  // Generate reports
  await ensureOutputDir(config.outputDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportConfig = {
    strategy: 'S4 CEX-DEX Arbitrage',
    pair: 'SOL/USDC (Binance Spot ↔ Jupiter)',
    period: `${config.startTime.toISOString()} → ${config.endTime.toISOString()}`,
    initialInventoryUsd: String(config.initialInventoryUsd),
  };

  if (config.outputFormat === 'markdown' || config.outputFormat === 'both') {
    const markdown = generateMarkdownReport(metrics, goNoGo, reportConfig);
    const mdPath = join(config.outputDir, `replay-report-${timestamp}.md`);
    await writeFile(mdPath, markdown, 'utf8');
    console.log(JSON.stringify({
      service: 'simulator:replay',
      output: 'markdown',
      path: mdPath,
    }));
  }

  if (config.outputFormat === 'html' || config.outputFormat === 'both') {
    const html = generateHtmlReport(metrics, goNoGo, reportConfig);
    const htmlPath = join(config.outputDir, `replay-report-${timestamp}.html`);
    await writeFile(htmlPath, html, 'utf8');
    console.log(JSON.stringify({
      service: 'simulator:replay',
      output: 'html',
      path: htmlPath,
    }));
  }

  // Final verdict
  console.log('');
  console.log('='.repeat(60));
  console.log(`VERDICT: ${goNoGo.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(goNoGo.summary);
  console.log('='.repeat(60));
}

// Run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runReplay().catch((error) => {
    console.error(JSON.stringify({
      service: 'simulator:replay',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    }));
    process.exit(1);
  });
}

export { runReplay, parseConfig, buildReplayConfig };
