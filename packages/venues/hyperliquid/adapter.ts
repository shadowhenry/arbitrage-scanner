import type { FundingRate } from '@arbitrage-scanner/core';
import { ReconnectingWebSocket } from '../src/websocket.js';
import { fetchHyperliquidFundingHistory, requestHyperliquidInfo } from './info.js';
import {
  normalizeHistoricalFunding,
  normalizeHyperliquidFunding,
  normalizeHyperliquidPerp,
  normalizeHyperliquidSpot,
} from './normalize.js';
import { HyperliquidLocalOrderBook } from './orderbook.js';
import type {
  HyperliquidAdapterOptions,
  HyperliquidAssetContextMessage,
  HyperliquidMarketState,
  HyperliquidMessage,
  HyperliquidPerpContext,
  HyperliquidPerpMetaAndContexts,
  HyperliquidSpotContext,
  HyperliquidSpotMarketMeta,
  HyperliquidSpotMetaAndContexts,
  HyperliquidSpotToken,
} from './types.js';

const HYPERLIQUID_WS_URL = 'wss://api.hyperliquid.xyz/ws';

interface SpotDefinition {
  readonly market: HyperliquidSpotMarketMeta;
  readonly base: HyperliquidSpotToken;
  readonly quote: HyperliquidSpotToken;
}

export class HyperliquidAdapter {
  readonly #options: HyperliquidAdapterOptions;
  readonly #books = new Map<string, HyperliquidLocalOrderBook>();
  readonly #perpContexts = new Map<string, HyperliquidPerpContext>();
  readonly #spotContexts = new Map<string, HyperliquidSpotContext>();
  readonly #spotDefinitions = new Map<string, SpotDefinition>();
  readonly #observedAt = new Map<string, number>();
  #connection: ReconnectingWebSocket | null = null;
  #initialized = false;

  constructor(options: HyperliquidAdapterOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#connection !== null) return;
    await this.initialize();
    const coins = [...this.#perpContexts.keys(), ...this.#spotContexts.keys()];
    this.#connection = new ReconnectingWebSocket(HYPERLIQUID_WS_URL, {
      staleAfterMs: this.#options.staleAfterMs ?? 10_000,
      heartbeatIntervalMs: 30_000,
      heartbeatPayload: JSON.stringify({ method: 'ping' }),
      onOpen: (send) => {
        for (const coin of coins) {
          send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin } }));
          send(JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin } }));
        }
      },
      onMessage: (message) => this.handleMessage(message),
      onStale: () => this.#emitAll(),
      ...(this.#options.onError === undefined ? {} : { onError: this.#options.onError }),
    });
    this.#connection.start();
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await this.#loadMetadata();
    this.#initialized = true;
  }

  stop(): void {
    this.#connection?.stop();
    this.#connection = null;
  }

  handleMessage(message: string): void {
    try {
      const event = JSON.parse(message) as HyperliquidMessage;
      if (event.channel === 'l2Book') {
        const book = this.#books.get(event.data.coin);
        if (book === undefined) return;
        book.push(event);
        this.#observedAt.set(event.data.coin, event.data.time);
        this.#emit(event.data.coin);
      } else if (event.channel === 'activeAssetCtx') {
        this.#handleContext(event);
      }
    } catch (error) {
      this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  getState(coin: string, now = Date.now()): HyperliquidMarketState | undefined {
    const observedTimestamp = this.#observedAt.get(coin);
    const book = this.#books.get(coin);
    if (observedTimestamp === undefined || book === undefined) return undefined;
    const observedAt = new Date(observedTimestamp);
    const best = book.bestPrices();
    const staleAfterMs = this.#options.staleAfterMs ?? 5_000;

    const perpContext = this.#perpContexts.get(coin);
    if (perpContext !== undefined) {
      const market = normalizeHyperliquidPerp(
        coin, perpContext, observedAt, best.bestBid, best.bestAsk,
      );
      const orderBook = book.toOrderBook(market);
      return {
        kind: 'perpetual',
        market,
        fundingRate: normalizeHyperliquidFunding(market.id, perpContext.funding, observedAt),
        ...(orderBook === undefined ? {} : { orderBook }),
        stale: now - observedTimestamp > staleAfterMs || book.isStale(now, staleAfterMs),
      };
    }

    const spotContext = this.#spotContexts.get(coin);
    const definition = this.#spotDefinitions.get(coin);
    if (spotContext === undefined || definition === undefined) return undefined;
    const quote = normalizeHyperliquidSpot(
      definition.market,
      definition.base,
      definition.quote,
      spotContext,
      observedAt,
      best.bestBid,
      best.bestAsk,
    );
    const orderBook = book.toOrderBook(quote);
    return {
      kind: 'spot',
      quote,
      ...(orderBook === undefined ? {} : { orderBook }),
      stale: now - observedTimestamp > staleAfterMs || book.isStale(now, staleAfterMs),
    };
  }

  async getHistoricalFunding(
    coin: string,
    startTime: number,
    endTime = Date.now(),
  ): Promise<readonly FundingRate[]> {
    const request = this.#options.requestInfo ?? requestHyperliquidInfo;
    const records = await fetchHyperliquidFundingHistory(coin, startTime, endTime, request);
    return records.map(normalizeHistoricalFunding);
  }

  async #loadMetadata(): Promise<void> {
    const request = this.#options.requestInfo ?? requestHyperliquidInfo;
    const [perpResponse, spotResponse] = await Promise.all([
      request<HyperliquidPerpMetaAndContexts>({ type: 'metaAndAssetCtxs' }),
      request<HyperliquidSpotMetaAndContexts>({ type: 'spotMetaAndAssetCtxs' }),
    ]);
    const now = Date.now();
    const [perpMeta, perpContexts] = perpResponse;
    for (const [index, metadata] of perpMeta.universe.entries()) {
      if (!this.#options.perpAssets.includes(metadata.name)) continue;
      const context = perpContexts[index];
      if (context === undefined) continue;
      this.#perpContexts.set(metadata.name, context);
      this.#observedAt.set(metadata.name, now);
      this.#books.set(metadata.name, new HyperliquidLocalOrderBook());
    }

    const requestedSpot = new Set(this.#options.spotAssets ?? []);
    const [spotMeta, spotContexts] = spotResponse;
    const tokens = new Map(spotMeta.tokens.map((token) => [token.index, token]));
    for (const [index, market] of spotMeta.universe.entries()) {
      const base = tokens.get(market.tokens[0]);
      const quote = tokens.get(market.tokens[1]);
      const context = spotContexts[index];
      if (base === undefined || quote === undefined || context === undefined || !requestedSpot.has(base.name)) {
        continue;
      }
      this.#spotDefinitions.set(market.name, { market, base, quote });
      this.#spotContexts.set(market.name, context);
      this.#observedAt.set(market.name, now);
      this.#books.set(market.name, new HyperliquidLocalOrderBook());
    }
    this.#emitAll();
  }

  #handleContext(event: HyperliquidAssetContextMessage): void {
    const { coin, ctx } = event.data;
    if (this.#perpContexts.has(coin) && 'funding' in ctx) this.#perpContexts.set(coin, ctx);
    else if (this.#spotContexts.has(coin) && !('funding' in ctx)) this.#spotContexts.set(coin, ctx);
    else return;
    this.#observedAt.set(coin, Date.now());
    this.#emit(coin);
  }

  #emit(coin: string): void {
    const state = this.getState(coin);
    if (state !== undefined) this.#options.onState(coin, state);
  }

  #emitAll(): void {
    for (const coin of this.#books.keys()) this.#emit(coin);
  }
}
