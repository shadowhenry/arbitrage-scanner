import type { FundingRate, MarketQuote, PerpMarket } from '@arbitrage-scanner/core';
import { ReconnectingWebSocket } from '../src/websocket.js';
import { normalizeBybitFundingRate, normalizeBybitLinearTicker, normalizeBybitSpotTicker } from './normalize.js';
import { BybitLocalOrderBook } from './orderbook.js';
import type {
  BybitAdapterOptions,
  BybitCategory,
  BybitLinearState,
  BybitMessage,
  BybitOrderBookEvent,
  BybitSpotState,
  BybitSymbol,
  BybitTickerData,
  BybitTickerEvent,
} from './types.js';

const BYBIT_WS_URL: Record<BybitCategory, string> = {
  spot: 'wss://stream.bybit.com/v5/public/spot',
  linear: 'wss://stream.bybit.com/v5/public/linear',
};

type BybitState = BybitSpotState | BybitLinearState;

export interface BybitPublicOptions extends BybitAdapterOptions {
  readonly category: BybitCategory;
  readonly onState: (symbol: BybitSymbol, state: BybitState) => void;
}

export class BybitPublicAdapter {
  readonly #options: BybitPublicOptions;
  readonly #books = new Map<BybitSymbol, BybitLocalOrderBook>();
  readonly #tickers = new Map<BybitSymbol, BybitTickerData>();
  readonly #tickerTimes = new Map<BybitSymbol, number>();
  #connection: ReconnectingWebSocket | null = null;

  constructor(options: BybitPublicOptions) {
    this.#options = options;
    for (const symbol of options.symbols) this.#books.set(symbol, new BybitLocalOrderBook());
  }

  start(): void {
    if (this.#connection !== null) return;
    const topics = this.#options.symbols.flatMap((symbol) => [
      `orderbook.50.${symbol}`,
      `tickers.${symbol}`,
    ]);
    this.#connection = new ReconnectingWebSocket(BYBIT_WS_URL[this.#options.category], {
      staleAfterMs: this.#options.staleAfterMs ?? 10_000,
      heartbeatIntervalMs: 20_000,
      heartbeatPayload: JSON.stringify({ op: 'ping' }),
      onOpen: (send) => send(JSON.stringify({ op: 'subscribe', args: topics })),
      onMessage: (message) => this.handleMessage(message),
      onStale: () => this.#emitAll(),
      ...(this.#options.onError === undefined ? {} : { onError: this.#options.onError }),
    });
    this.#connection.start();
  }

  stop(): void {
    this.#connection?.stop();
    this.#connection = null;
  }

  handleMessage(message: string): void {
    try {
      const event = JSON.parse(message) as BybitMessage;
      if (!('topic' in event)) return;
      if (event.topic.startsWith('orderbook.')) this.#handleOrderBook(event as BybitOrderBookEvent);
      else if (event.topic.startsWith('tickers.')) this.#handleTicker(event as BybitTickerEvent);
    } catch (error) {
      this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  getState(symbol: BybitSymbol, now = Date.now()): BybitState | undefined {
    const ticker = this.#tickers.get(symbol);
    const tickerAt = this.#tickerTimes.get(symbol);
    const book = this.#books.get(symbol);
    if (ticker === undefined || tickerAt === undefined || book === undefined) return undefined;
    const observedAt = new Date(tickerAt);
    const staleAfterMs = this.#options.staleAfterMs ?? 5_000;

    if (this.#options.category === 'spot') {
      let quote: MarketQuote;
      try {
        quote = normalizeBybitSpotTicker(ticker, observedAt);
      } catch {
        // Incomplete ticker (e.g. a delta event without bid1Price). Keep the
        // previous state and wait for a full snapshot instead of erroring.
        return undefined;
      }
      const orderBook = book.toOrderBook(quote);
      return {
        quote,
        ...(orderBook === undefined ? {} : { orderBook }),
        stale: now - tickerAt > staleAfterMs || book.isStale(now, staleAfterMs),
      };
    }

    let market: PerpMarket;
    let fundingRate: FundingRate;
    try {
      market = normalizeBybitLinearTicker(ticker, observedAt);
      fundingRate = normalizeBybitFundingRate(ticker, observedAt);
    } catch {
      return undefined;
    }
    const orderBook = book.toOrderBook(market);
    return {
      market,
      fundingRate,
      ...(orderBook === undefined ? {} : { orderBook }),
      stale: now - tickerAt > staleAfterMs || book.isStale(now, staleAfterMs),
    };
  }

  #handleOrderBook(event: BybitOrderBookEvent): void {
    const symbol = event.data.s as BybitSymbol;
    const book = this.#books.get(symbol);
    if (book === undefined) return;
    book.push(event);
    this.#emit(symbol);
  }

  #handleTicker(event: BybitTickerEvent): void {
    const symbol = event.data.symbol as BybitSymbol;
    if (!this.#books.has(symbol)) return;
    const previous = this.#tickers.get(symbol);
    this.#tickers.set(symbol, event.type === 'snapshot' ? event.data : { ...previous, ...event.data });
    this.#tickerTimes.set(symbol, event.ts);
    this.#emit(symbol);
  }

  #emit(symbol: BybitSymbol): void {
    const state = this.getState(symbol);
    if (state !== undefined) this.#options.onState(symbol, state);
  }

  #emitAll(): void {
    for (const symbol of this.#options.symbols) this.#emit(symbol);
  }
}

export function marketFromState(state: BybitState): MarketQuote | PerpMarket {
  return 'quote' in state ? state.quote : state.market;
}

