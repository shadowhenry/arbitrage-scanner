import type { FundingRate, MarketQuote, OrderBook, PerpMarket } from '@arbitrage-scanner/core';

export interface HyperliquidPerpMeta {
  readonly universe: readonly { readonly name: string; readonly szDecimals: number }[];
}

export interface HyperliquidPerpContext {
  readonly funding: string;
  readonly markPx: string;
  readonly oraclePx: string;
  readonly midPx?: string;
  readonly openInterest?: string;
  readonly dayNtlVlm?: string;
}

export type HyperliquidPerpMetaAndContexts = readonly [
  HyperliquidPerpMeta,
  readonly HyperliquidPerpContext[],
];

export interface HyperliquidSpotToken {
  readonly name: string;
  readonly szDecimals: number;
  readonly weiDecimals: number;
  readonly index: number;
  readonly tokenId: string;
}

export interface HyperliquidSpotMarketMeta {
  readonly name: string;
  readonly tokens: readonly [number, number];
  readonly index: number;
}

export interface HyperliquidSpotMeta {
  readonly tokens: readonly HyperliquidSpotToken[];
  readonly universe: readonly HyperliquidSpotMarketMeta[];
}

export interface HyperliquidSpotContext {
  readonly markPx: string;
  readonly midPx?: string;
  readonly dayNtlVlm?: string;
  readonly circulatingSupply?: string;
}

export type HyperliquidSpotMetaAndContexts = readonly [
  HyperliquidSpotMeta,
  readonly HyperliquidSpotContext[],
];

export interface HyperliquidBookLevel {
  readonly px: string;
  readonly sz: string;
  readonly n: number;
}

export interface HyperliquidL2BookMessage {
  readonly channel: 'l2Book';
  readonly data: {
    readonly coin: string;
    readonly levels: readonly [
      readonly HyperliquidBookLevel[],
      readonly HyperliquidBookLevel[],
    ];
    readonly time: number;
  };
}

export interface HyperliquidAssetContextMessage {
  readonly channel: 'activeAssetCtx';
  readonly data: {
    readonly coin: string;
    readonly ctx: HyperliquidPerpContext | HyperliquidSpotContext;
  };
}

export interface HyperliquidControlMessage {
  readonly channel: 'subscriptionResponse' | 'pong';
  readonly data?: unknown;
}

export type HyperliquidMessage =
  | HyperliquidL2BookMessage
  | HyperliquidAssetContextMessage
  | HyperliquidControlMessage;

export interface HyperliquidFundingHistoryRecord {
  readonly coin: string;
  readonly fundingRate: string;
  readonly premium: string;
  readonly time: number;
}

export interface HyperliquidPerpState {
  readonly kind: 'perpetual';
  readonly market: PerpMarket;
  readonly fundingRate: FundingRate;
  readonly orderBook?: OrderBook;
  readonly stale: boolean;
}

export interface HyperliquidSpotState {
  readonly kind: 'spot';
  readonly quote: MarketQuote;
  readonly orderBook?: OrderBook;
  readonly stale: boolean;
}

export type HyperliquidMarketState = HyperliquidPerpState | HyperliquidSpotState;

export interface HyperliquidAdapterOptions {
  readonly perpAssets: readonly string[];
  readonly spotAssets?: readonly string[];
  readonly staleAfterMs?: number;
  readonly onState: (coin: string, state: HyperliquidMarketState) => void;
  readonly onError?: (error: Error) => void;
  readonly requestInfo?: <T>(payload: object) => Promise<T>;
}

