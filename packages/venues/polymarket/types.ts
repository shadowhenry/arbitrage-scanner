import type { BinaryPredictionMarketSnapshot, PredictionMarket } from '@arbitrage-scanner/core';

export const POLYMARKET_VENUE = { id: 'polymarket', name: 'Polymarket', kind: 'prediction' } as const;

export interface GammaFeeSchedule {
  readonly exponent: number;
  readonly rate: number;
  readonly takerOnly: boolean;
  readonly rebateRate: number;
}

export interface GammaMarketResponse {
  readonly id: string;
  readonly question: string | null;
  readonly conditionId: string;
  readonly slug: string | null;
  readonly description?: string | null;
  readonly endDate?: string | null;
  readonly endDateIso?: string | null;
  readonly outcomes: string;
  readonly clobTokenIds: string;
  readonly active?: boolean | null;
  readonly closed?: boolean | null;
  readonly enableOrderBook?: boolean | null;
  readonly acceptingOrders?: boolean | null;
  readonly feesEnabled?: boolean | null;
  readonly feeSchedule?: GammaFeeSchedule | null;
}

export interface ClobOrderBookLevelResponse {
  readonly price: string;
  readonly size: string;
}

export interface ClobOrderBookResponse {
  readonly market: string;
  readonly asset_id: string;
  readonly timestamp: string;
  readonly hash: string;
  readonly bids: readonly ClobOrderBookLevelResponse[];
  readonly asks: readonly ClobOrderBookLevelResponse[];
  readonly min_order_size: string;
  readonly tick_size: string;
  readonly neg_risk: boolean;
  readonly last_trade_price?: string;
}

export interface ClobFeeRateResponse {
  readonly base_fee: number;
}

export interface ClobMarketInfoResponse {
  readonly fd?: {
    readonly r: number;
    readonly e: number;
    readonly to: boolean;
  };
}

export interface DiscoveredPolymarketMarket {
  readonly market: PredictionMarket;
  readonly yesTokenId: string;
  readonly noTokenId: string;
  readonly feesEnabled: boolean;
  readonly feeSchedule?: GammaFeeSchedule;
}

export type PolymarketFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface PolymarketAdapterOptions {
  readonly gammaUrl?: string;
  readonly clobUrl?: string;
  readonly cacheTtlMs?: number;
  readonly cacheMaxEntries?: number;
  readonly rateLimitRequests?: number;
  readonly rateLimitIntervalMs?: number;
  readonly fetch?: PolymarketFetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface DiscoverMarketsOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly active?: boolean;
  readonly closed?: boolean;
}

export interface PolymarketVenueAdapter {
  discoverMarkets(options?: DiscoverMarketsOptions): Promise<readonly DiscoveredPolymarketMarket[]>;
  getBinarySnapshot(market: DiscoveredPolymarketMarket): Promise<BinaryPredictionMarketSnapshot>;
  clearCache(): void;
}
