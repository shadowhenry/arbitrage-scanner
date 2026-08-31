import type { MarketId, NormalizedOrderBook } from '@arbitrage-scanner/core';

export * from './orderbook.js';
export * from './websocket.js';

export interface VenueAdapter {
  readonly name: string;
  listMarkets(): Promise<readonly MarketId[]>;
  getOrderBook(market: MarketId): Promise<NormalizedOrderBook>;
  close(): Promise<void>;
}
