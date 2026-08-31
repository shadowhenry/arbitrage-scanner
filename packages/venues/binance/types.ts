import type { FundingRate, OrderBook, PerpMarket, MarketQuote } from '@arbitrage-scanner/core';

export type BinanceSymbol = `${string}USDT`;
export type RawPriceLevel = readonly [price: string, quantity: string];

export interface BinanceDepthSnapshot {
  readonly lastUpdateId: number;
  readonly bids: readonly RawPriceLevel[];
  readonly asks: readonly RawPriceLevel[];
}

export interface BinanceDepthEvent {
  readonly e: 'depthUpdate';
  readonly E: number;
  readonly s: string;
  readonly U: number;
  readonly u: number;
  readonly pu?: number;
  readonly b: readonly RawPriceLevel[];
  readonly a: readonly RawPriceLevel[];
}

export interface BinanceBookTickerEvent {
  readonly e?: 'bookTicker';
  readonly E?: number;
  readonly T?: number;
  readonly u: number;
  readonly s: string;
  readonly b: string;
  readonly B: string;
  readonly a: string;
  readonly A: string;
}

export interface BinanceMarkPriceEvent {
  readonly e: 'markPriceUpdate';
  readonly E: number;
  readonly s: string;
  readonly p: string;
  readonly i: string;
  readonly r: string;
  readonly T: number;
}

export interface BinanceCombinedEvent<T = unknown> {
  readonly stream: string;
  readonly data: T;
}

export interface BinanceSpotState {
  readonly quote: MarketQuote;
  readonly orderBook?: OrderBook;
  readonly stale: boolean;
}

export interface BinanceFuturesState {
  readonly market: PerpMarket;
  readonly fundingRate: FundingRate;
  readonly orderBook?: OrderBook;
  readonly stale: boolean;
}

export type OrderBookUpdateResult = 'buffered' | 'applied' | 'ignored' | 'resync-required';

export interface BinanceAdapterOptions {
  readonly symbols: readonly BinanceSymbol[];
  readonly staleAfterMs?: number;
  readonly onError?: (error: Error) => void;
}

