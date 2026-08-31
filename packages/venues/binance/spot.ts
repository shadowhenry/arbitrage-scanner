import type { MarketQuote } from '@arbitrage-scanner/core';
import { BinanceLocalOrderBook } from './orderbook.js';
import { normalizeSpotQuote } from './normalize.js';
import type {
  BinanceAdapterOptions,
  BinanceBookTickerEvent,
  BinanceCombinedEvent,
  BinanceDepthEvent,
  BinanceDepthSnapshot,
  BinanceSpotState,
  BinanceSymbol,
} from './types.js';
import { ReconnectingWebSocket } from './websocket.js';

const SPOT_REST_URL = 'https://api.binance.com/api/v3/depth';
const SPOT_WS_URL = 'wss://stream.binance.com:9443/stream?streams=';

export interface BinanceSpotOptions extends BinanceAdapterOptions {
  readonly onState: (symbol: BinanceSymbol, state: BinanceSpotState) => void;
  readonly fetchSnapshot?: (symbol: BinanceSymbol) => Promise<BinanceDepthSnapshot>;
}

export class BinanceSpotAdapter {
  readonly #options: BinanceSpotOptions;
  readonly #books = new Map<BinanceSymbol, BinanceLocalOrderBook>();
  readonly #quotes = new Map<BinanceSymbol, MarketQuote>();
  readonly #syncing = new Set<BinanceSymbol>();
  #connection: ReconnectingWebSocket | null = null;
  #running = false;

  constructor(options: BinanceSpotOptions) {
    this.#options = options;
    for (const symbol of options.symbols) this.#books.set(symbol, new BinanceLocalOrderBook('spot'));
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const streams = this.#options.symbols.flatMap((symbol) => {
      const lower = symbol.toLowerCase();
      return [`${lower}@bookTicker`, `${lower}@depth@100ms`];
    }).join('/');
    this.#connection = new ReconnectingWebSocket(`${SPOT_WS_URL}${streams}`, {
      ...(this.#options.staleAfterMs === undefined ? {} : { staleAfterMs: this.#options.staleAfterMs }),
      onMessage: (message) => this.handleMessage(message),
      onStale: () => this.#emitAll(),
      ...(this.#options.onError === undefined ? {} : { onError: this.#options.onError }),
    });
    this.#connection.start();
  }

  stop(): void {
    this.#running = false;
    this.#connection?.stop();
    this.#connection = null;
  }

  handleMessage(message: string): void {
    try {
      const envelope = JSON.parse(message) as BinanceCombinedEvent<BinanceDepthEvent | BinanceBookTickerEvent>;
      const event = envelope.data;
      const symbol = event.s as BinanceSymbol;
      if (!this.#books.has(symbol)) return;

      if ('U' in event) {
        const result = this.#books.get(symbol)?.push(event);
        if (result === 'buffered' || result === 'resync-required') void this.#synchronize(symbol);
        else if (result === 'applied') this.#emit(symbol);
      } else {
        this.#quotes.set(symbol, normalizeSpotQuote(event));
        this.#emit(symbol);
      }
    } catch (error) {
      this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  getState(symbol: BinanceSymbol, now = Date.now()): BinanceSpotState | undefined {
    const quote = this.#quotes.get(symbol);
    const localBook = this.#books.get(symbol);
    if (quote === undefined || localBook === undefined) return undefined;
    const orderBook = localBook.toOrderBook(quote);
    return {
      quote,
      ...(orderBook === undefined ? {} : { orderBook }),
      stale: localBook.isStale(now, this.#options.staleAfterMs ?? 5_000),
    };
  }

  async #synchronize(symbol: BinanceSymbol): Promise<void> {
    if (this.#syncing.has(symbol)) return;
    this.#syncing.add(symbol);
    try {
      const book = this.#books.get(symbol);
      if (book === undefined) return;
      while (this.#running && !book.synchronized) {
        const snapshot = await (this.#options.fetchSnapshot?.(symbol) ?? fetchSpotSnapshot(symbol));
        if (book.synchronize(snapshot)) this.#emit(symbol);
      }
    } catch (error) {
      this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#syncing.delete(symbol);
    }
  }

  #emit(symbol: BinanceSymbol): void {
    const state = this.getState(symbol);
    if (state !== undefined) this.#options.onState(symbol, state);
  }

  #emitAll(): void {
    for (const symbol of this.#options.symbols) this.#emit(symbol);
  }
}

export async function fetchSpotSnapshot(symbol: BinanceSymbol): Promise<BinanceDepthSnapshot> {
  const response = await fetch(`${SPOT_REST_URL}?symbol=${symbol}&limit=5000`);
  if (!response.ok) throw new Error(`Binance Spot depth snapshot failed: HTTP ${response.status}`);
  return response.json() as Promise<BinanceDepthSnapshot>;
}
