import type { FundingRate, MarketQuote, OrderBook, PerpMarket } from '@arbitrage-scanner/core';
import type { RawOrderBookLevel } from '../src/orderbook.js';

export type BybitCategory = 'spot' | 'linear';
export type BybitSymbol = `${string}USDT`;

export interface BybitOrderBookEvent {
  readonly topic: string;
  readonly type: 'snapshot' | 'delta';
  readonly ts: number;
  readonly data: {
    readonly s: string;
    readonly b: readonly RawOrderBookLevel[];
    readonly a: readonly RawOrderBookLevel[];
    readonly u: number;
    readonly seq: number;
  };
  readonly cts?: number;
}

export interface BybitTickerData {
  readonly symbol: string;
  readonly lastPrice?: string;
  readonly bid1Price?: string;
  readonly bid1Size?: string;
  readonly ask1Price?: string;
  readonly ask1Size?: string;
  readonly markPrice?: string;
  readonly indexPrice?: string;
  readonly fundingRate?: string;
  readonly nextFundingTime?: string;
  readonly fundingIntervalHour?: string;
}

export interface BybitTickerEvent {
  readonly topic: string;
  readonly type: 'snapshot' | 'delta';
  readonly ts: number;
  readonly cs?: number;
  readonly data: BybitTickerData;
}

export interface BybitCommandResponse {
  readonly success?: boolean;
  readonly op?: 'subscribe' | 'ping' | 'pong';
  readonly ret_msg?: string;
}

export type BybitMessage = BybitOrderBookEvent | BybitTickerEvent | BybitCommandResponse;
export type BybitBookResult = 'snapshot' | 'applied' | 'ignored' | 'awaiting-snapshot';

export interface BybitSpotState {
  readonly quote: MarketQuote;
  readonly orderBook?: OrderBook;
  readonly stale: boolean;
}

export interface BybitLinearState {
  readonly market: PerpMarket;
  readonly fundingRate: FundingRate;
  readonly orderBook?: OrderBook;
  readonly stale: boolean;
}

export interface BybitAdapterOptions {
  readonly symbols: readonly BybitSymbol[];
  readonly staleAfterMs?: number;
  readonly onError?: (error: Error) => void;
}

