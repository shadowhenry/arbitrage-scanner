import type { BinanceFuturesState, BinanceSymbol } from './types.js';
import type {
  BinanceAdapterOptions,
  BinanceBookTickerEvent,
  BinanceCombinedEvent,
  BinanceDepthEvent,
  BinanceDepthSnapshot,
  BinanceMarkPriceEvent,
} from './types.js';
import { BinanceLocalOrderBook } from './orderbook.js';
import { normalizeFundingRate, normalizePerpMarket } from './normalize.js';
import { ReconnectingWebSocket } from './websocket.js';

const FUTURES_REST_URL = 'https://fapi.binance.com/fapi/v1/depth';
const FUTURES_WS_URL = 'wss://fstream.binance.com/stream?streams=';

export interface BinanceFuturesOptions extends BinanceAdapterOptions {
  readonly onState: (symbol: BinanceSymbol, state: BinanceFuturesState) => void;
  readonly fetchSnapshot?: (symbol: BinanceSymbol) => Promise<BinanceDepthSnapshot>;
}

export class BinanceFuturesAdapter {
  readonly #options: BinanceFuturesOptions;
  readonly #books = new Map<BinanceSymbol, BinanceLocalOrderBook>();
  readonly #marks = new Map<BinanceSymbol, BinanceMarkPriceEvent>();
  readonly #tickers = new Map<BinanceSymbol, BinanceBookTickerEvent>();
  readonly #syncing = new Set<BinanceSymbol>();
  #connection: ReconnectingWebSocket | null = null;
  #running = false;

  constructor(options: BinanceFuturesOptions) {
    this.#options = options;
    for (const symbol of options.symbols) this.#books.set(symbol, new BinanceLocalOrderBook('futures'));
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const streams = this.#options.symbols.flatMap((symbol) => {
      const lower = symbol.toLowerCase();
      return [`${lower}@bookTicker`, `${lower}@depth@100ms`, `${lower}@markPrice@1s`];
    }).join('/');
    this.#connection = new ReconnectingWebSocket(`${FUTURES_WS_URL}${streams}`, {
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
      const envelope = JSON.parse(message) as BinanceCombinedEvent<
        BinanceDepthEvent | BinanceBookTickerEvent | BinanceMarkPriceEvent
      >;
      const event = envelope.data;
      const symbol = event.s as BinanceSymbol;
      if (!this.#books.has(symbol)) return;

      if (event.e === 'depthUpdate') {
        const result = this.#books.get(symbol)?.push(event);
        if (result === 'buffered' || result === 'resync-required') void this.#synchronize(symbol);
        else if (result === 'applied') this.#emit(symbol);
      } else if (event.e === 'markPriceUpdate') {
        this.#marks.set(symbol, event);
        this.#emit(symbol);
      } else {
        this.#tickers.set(symbol, event);
        this.#emit(symbol);
      }
    } catch (error) {
      this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  getState(symbol: BinanceSymbol, now = Date.now()): BinanceFuturesState | undefined {
    const mark = this.#marks.get(symbol);
    const localBook = this.#books.get(symbol);
    if (mark === undefined || localBook === undefined) return undefined;
    const market = normalizePerpMarket(mark, this.#tickers.get(symbol));
    const orderBook = localBook.toOrderBook(market);
    return {
      market,
      fundingRate: normalizeFundingRate(mark),
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
        const snapshot = await (this.#options.fetchSnapshot?.(symbol) ?? fetchFuturesSnapshot(symbol));
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

export async function fetchFuturesSnapshot(symbol: BinanceSymbol): Promise<BinanceDepthSnapshot> {
  const response = await fetch(`${FUTURES_REST_URL}?symbol=${symbol}&limit=1000`);
  if (!response.ok) throw new Error(`Binance USD-M depth snapshot failed: HTTP ${response.status}`);
  return response.json() as Promise<BinanceDepthSnapshot>;
}
