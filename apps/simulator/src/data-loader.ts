import type { Pool } from 'pg';
import type {
  BinanceOrderBookSnapshot,
  JupiterQuoteSnapshot,
  ReplayEvent,
} from './replay-types.js';

/**
 * Configuration for loading historical replay data from PostgreSQL.
 */
export interface DataLoaderConfig {
  /** Start time of the replay window (inclusive). */
  readonly startTime: Date;
  /** End time of the replay window (exclusive). */
  readonly endTime: Date;
  /** Market ID for Binance SOL/USDT spot in the `markets` table. */
  readonly binanceMarketId: number;
  /** Market ID for Jupiter SOL/USDC in the `markets` table. */
  readonly jupiterMarketId: number;
  /** Maximum number of order book snapshots to load. */
  readonly maxOrderBooks?: number;
  /** Maximum number of DEX quotes to load. */
  readonly maxDexQuotes?: number;
}

/**
 * Summary of loaded data for logging and validation.
 */
export interface DataLoadSummary {
  readonly orderBookCount: number;
  readonly dexQuoteCount: number;
  readonly totalEvents: number;
  readonly startTime: Date;
  readonly endTime: Date;
}

interface OrderBookRow {
  readonly observed_at: Date;
  readonly bids: string;
  readonly asks: string;
}

interface DexQuoteRow {
  readonly observed_at: Date;
  readonly direction: 'buy' | 'sell';
  readonly capital_bucket_usd: string;
  readonly input_amount: string;
  readonly output_amount: string;
  readonly effective_price: string;
  readonly price_impact_pct: string;
}

/**
 * Loads historical market data from PostgreSQL and converts it into a
 * chronological stream of ReplayEvent objects for the replay engine.
 *
 * Data sources:
 * - `orderbook_snapshots`: Binance spot order book depth
 * - `dex_quotes`: Jupiter routing quotes (bidirectional)
 *
 * Both sources are merged and sorted by observed timestamp.
 */
export class HistoricalDataLoader {
  private readonly pool: Pool;
  private readonly config: DataLoaderConfig;

  constructor(pool: Pool, config: DataLoaderConfig) {
    this.pool = pool;
    this.config = config;
  }

  /**
   * Loads all events within the configured time window.
   * Returns events sorted chronologically.
   */
  async loadEvents(): Promise<{ readonly events: readonly ReplayEvent[]; readonly summary: DataLoadSummary }> {
    const [orderBooks, dexQuotes] = await Promise.all([
      this.loadOrderBooks(),
      this.loadDexQuotes(),
    ]);

    const events: ReplayEvent[] = [...orderBooks, ...dexQuotes];
    events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const summary: DataLoadSummary = {
      orderBookCount: orderBooks.length,
      dexQuoteCount: dexQuotes.length,
      totalEvents: events.length,
      startTime: this.config.startTime,
      endTime: this.config.endTime,
    };

    return { events, summary };
  }

  private async loadOrderBooks(): Promise<ReplayEvent[]> {
    const limit = this.config.maxOrderBooks ?? 1_000_000;
    const result = await this.pool.query<OrderBookRow>(
      `SELECT observed_at, bids, asks
       FROM orderbook_snapshots
       WHERE market_id = $1
         AND observed_at >= $2
         AND observed_at < $3
       ORDER BY observed_at ASC
       LIMIT $4`,
      [this.config.binanceMarketId, this.config.startTime, this.config.endTime, limit],
    );

    return result.rows.map((row) => this.parseOrderBookEvent(row));
  }

  private parseOrderBookEvent(row: OrderBookRow): ReplayEvent {
    let bids: readonly { readonly price: string; readonly quantity: string }[] = [];
    let asks: readonly { readonly price: string; readonly quantity: string }[] = [];

    try {
      const parsedBids = JSON.parse(row.bids) as unknown[];
      const parsedAsks = JSON.parse(row.asks) as unknown[];
      bids = parsedBids.map((level) => this.parseOrderBookLevel(level));
      asks = parsedAsks.map((level) => this.parseOrderBookLevel(level));
    } catch {
      // If JSON parsing fails, use empty books (will be skipped by engine)
    }

    const payload: BinanceOrderBookSnapshot = {
      symbol: 'SOLUSDT',
      bids,
      asks,
      observedAt: row.observed_at,
    };

    return {
      type: 'binance-orderbook',
      timestamp: row.observed_at,
      payload,
    };
  }

  private parseOrderBookLevel(level: unknown): { readonly price: string; readonly quantity: string } {
    if (Array.isArray(level) && level.length >= 2) {
      return { price: String(level[0]), quantity: String(level[1]) };
    }
    if (typeof level === 'object' && level !== null) {
      const obj = level as Record<string, unknown>;
      return {
        price: String(obj.price ?? obj.p ?? '0'),
        quantity: String(obj.quantity ?? obj.qty ?? obj.q ?? '0'),
      };
    }
    return { price: '0', quantity: '0' };
  }

  private async loadDexQuotes(): Promise<ReplayEvent[]> {
    const limit = this.config.maxDexQuotes ?? 2_000_000;
    const result = await this.pool.query<DexQuoteRow>(
      `SELECT observed_at, direction, capital_bucket_usd,
              input_amount, output_amount, effective_price, price_impact_pct
       FROM dex_quotes
       WHERE market_id = $1
         AND observed_at >= $2
         AND observed_at < $3
       ORDER BY observed_at ASC
       LIMIT $4`,
      [this.config.jupiterMarketId, this.config.startTime, this.config.endTime, limit],
    );

    return result.rows.map((row) => this.parseDexQuoteEvent(row));
  }

  private parseDexQuoteEvent(row: DexQuoteRow): ReplayEvent {
    const payload: JupiterQuoteSnapshot = {
      direction: row.direction,
      notionalUsd: Number(row.capital_bucket_usd),
      inputAmount: row.input_amount,
      outputAmount: row.output_amount,
      effectivePrice: row.effective_price,
      priceImpact: row.price_impact_pct,
      observedAt: row.observed_at,
    };

    return {
      type: 'jupiter-quote',
      timestamp: row.observed_at,
      payload,
    };
  }
}

/**
 * Generates synthetic replay events for testing or when database data
 * is not available. Creates a price series with a configurable spread
 * between Binance and Jupiter.
 */
export function generateSyntheticEvents(
  startTime: Date,
  endTime: Date,
  intervalMs: number,
  options: {
    readonly binanceMidPrice?: number;
    readonly jupiterPremiumBps?: number;
    readonly volatilityBps?: number;
  } = {},
): ReplayEvent[] {
  const midPrice = options.binanceMidPrice ?? 150;
  const premiumBps = options.jupiterPremiumBps ?? 20;
  const volatility = options.volatilityBps ?? 5;

  const events: ReplayEvent[] = [];
  const durationMs = endTime.getTime() - startTime.getTime();
  const steps = Math.floor(durationMs / intervalMs);

  for (let i = 0; i < steps; i += 1) {
    const timestamp = new Date(startTime.getTime() + i * intervalMs);
    const noise = (Math.sin(i * 0.3) + Math.cos(i * 0.7)) * volatility;
    const price = midPrice * (1 + noise / 10_000);
    const bidPrice = (price * 0.9995).toFixed(4);
    const askPrice = (price * 1.0005).toFixed(4);

    // Binance order book event
    events.push({
      type: 'binance-orderbook',
      timestamp,
      payload: {
        symbol: 'SOLUSDT',
        bids: [{ price: bidPrice, quantity: '1000' }],
        asks: [{ price: askPrice, quantity: '1000' }],
        observedAt: timestamp,
      },
    });

    // Jupiter sell quote (SOL→USDC) at a premium to Binance ask
    const jupiterSellPrice = (price * (1 + premiumBps / 10_000)).toFixed(4);
    for (const notional of [100, 500, 1000, 2500, 5000]) {
      events.push({
        type: 'jupiter-quote',
        timestamp: new Date(timestamp.getTime() + 50),
        payload: {
          direction: 'sell',
          notionalUsd: notional,
          inputAmount: String(notional / Number(jupiterSellPrice)),
          outputAmount: String(notional),
          effectivePrice: jupiterSellPrice,
          priceImpact: '0.001',
          observedAt: timestamp,
        },
      });
    }
  }

  return events;
}
