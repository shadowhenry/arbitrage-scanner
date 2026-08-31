import type { MarketQuote, OrderBook } from '@arbitrage-scanner/core';
import { MutableOrderBook } from '../src/orderbook.js';
import type {
  BinanceDepthEvent,
  BinanceDepthSnapshot,
  OrderBookUpdateResult,
} from './types.js';

type SequenceMode = 'spot' | 'futures';

export class BinanceLocalOrderBook {
  readonly #levels = new MutableOrderBook();
  readonly #buffer: BinanceDepthEvent[] = [];
  readonly #sequenceMode: SequenceMode;
  #lastUpdateId: number | null = null;
  #lastEventAt: number | null = null;

  constructor(sequenceMode: SequenceMode) {
    this.#sequenceMode = sequenceMode;
  }

  get synchronized(): boolean {
    return this.#lastUpdateId !== null;
  }

  get lastUpdateId(): number | null {
    return this.#lastUpdateId;
  }

  get bufferedEventCount(): number {
    return this.#buffer.length;
  }

  push(event: BinanceDepthEvent): OrderBookUpdateResult {
    this.#lastEventAt = event.E;
    if (this.#lastUpdateId === null) {
      this.#buffer.push(event);
      return 'buffered';
    }
    return this.#applyEvent(event);
  }

  /**
   * Applies a REST snapshot and replays buffered WebSocket events. Returns false
   * when the snapshot is older than the first useful event and must be fetched again.
   */
  synchronize(snapshot: BinanceDepthSnapshot): boolean {
    const pending = this.#buffer.filter((event) => event.u > snapshot.lastUpdateId);
    const first = pending[0];
    if (first !== undefined && first.U > snapshot.lastUpdateId + 1) return false;

    this.#levels.replace(snapshot.bids, snapshot.asks);
    this.#lastUpdateId = snapshot.lastUpdateId;
    this.#buffer.length = 0;

    const bridgingEvent = pending.shift();
    if (bridgingEvent !== undefined) {
      this.#levels.apply(bridgingEvent.b, bridgingEvent.a);
      this.#lastUpdateId = bridgingEvent.u;
    }

    for (const event of pending) {
      const result = this.#applyEvent(event);
      if (result === 'resync-required') return false;
    }
    return true;
  }

  reset(event?: BinanceDepthEvent): void {
    this.#levels.clear();
    this.#lastUpdateId = null;
    this.#buffer.length = 0;
    if (event !== undefined) this.#buffer.push(event);
  }

  isStale(now = Date.now(), staleAfterMs = 5_000): boolean {
    return this.#lastEventAt === null || now - this.#lastEventAt > staleAfterMs;
  }

  toOrderBook(market: MarketQuote, limit = 5_000): OrderBook | undefined {
    if (!this.synchronized) return undefined;
    return this.#levels.toNormalized(
      market,
      new Date(this.#lastEventAt ?? market.observedAt.getTime()),
      String(this.#lastUpdateId),
      limit,
    );
  }

  #applyEvent(event: BinanceDepthEvent): OrderBookUpdateResult {
    const current = this.#lastUpdateId;
    if (current === null) {
      this.#buffer.push(event);
      return 'buffered';
    }
    if (event.u <= current) return 'ignored';

    const missingSpotSequence = event.U > current + 1;
    const missingFuturesSequence = this.#sequenceMode === 'futures'
      && event.pu !== undefined
      && event.pu !== current;
    if (missingSpotSequence || missingFuturesSequence) {
      this.reset(event);
      return 'resync-required';
    }

    this.#levels.apply(event.b, event.a);
    this.#lastUpdateId = event.u;
    return 'applied';
  }

}
