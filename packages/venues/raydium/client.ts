import {
  Decimal,
  EXECUTABLE_NOTIONALS_USD,
  type ExecutableNotionalUsd,
  type RoutingExecutablePriceCurve,
} from '@arbitrage-scanner/core';
import type { JupiterMarketConfig } from '../jupiter/types.js';
import { TtlPromiseCache } from '../src/cache.js';
import { SlidingWindowRateLimiter } from '../src/rate-limit.js';
import { normalizeRaydiumQuote } from './normalize.js';
import {
  RAYDIUM_MARKETS,
  type RaydiumAdapterOptions,
  type RaydiumPoolInfoResponse,
  type RaydiumQuoteResponse,
  type RaydiumVenueAdapter,
} from './types.js';

const DEFAULT_QUOTE_URL = 'https://transaction-v1.raydium.io/compute/swap-base-in';
const DEFAULT_POOL_URL = 'https://api-v3.raydium.io/pools/info/ids';

interface ReceivedQuote {
  readonly response: RaydiumQuoteResponse;
  readonly receivedAt: Date;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class RaydiumAdapter implements RaydiumVenueAdapter {
  private readonly markets: readonly JupiterMarketConfig[];
  private readonly quoteUrl: string;
  private readonly poolInfoUrl: string;
  private readonly slippageBps: number;
  private readonly request: NonNullable<RaydiumAdapterOptions['fetch']>;
  private readonly now: () => number;
  private readonly quoteCache: TtlPromiseCache<ReceivedQuote>;
  private readonly poolCache: TtlPromiseCache<RaydiumPoolInfoResponse>;
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(options: RaydiumAdapterOptions = {}) {
    this.markets = options.markets ?? RAYDIUM_MARKETS;
    this.quoteUrl = options.quoteUrl ?? DEFAULT_QUOTE_URL;
    this.poolInfoUrl = options.poolInfoUrl ?? DEFAULT_POOL_URL;
    this.slippageBps = options.slippageBps ?? 50;
    if (!Number.isInteger(this.slippageBps) || this.slippageBps < 0 || this.slippageBps > 10_000) {
      throw new RangeError('slippageBps must be an integer from 0 to 10000');
    }
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    const ttl = options.cacheTtlMs ?? 5_000;
    const capacity = options.cacheMaxEntries ?? 1_000;
    this.quoteCache = new TtlPromiseCache(ttl, capacity, this.now);
    this.poolCache = new TtlPromiseCache(ttl, capacity, this.now);
    this.limiter = new SlidingWindowRateLimiter(
      options.rateLimitRequests ?? 10,
      options.rateLimitIntervalMs ?? 1_000,
      this.now,
      options.sleep ?? delay,
    );
  }

  async getCurve(market: JupiterMarketConfig): Promise<RoutingExecutablePriceCurve> {
    const received = await Promise.all(EXECUTABLE_NOTIONALS_USD.map((tier) => this.getQuote(market, tier)));
    const poolIds = [...new Set(received.flatMap(({ response }) => response.data.routePlan.map((step) => step.poolId)))];
    const poolResponse = await this.getPools(poolIds);
    const poolInfo = new Map(poolResponse.data.map((pool) => [pool.id, pool]));
    const observedAt = new Date(this.now());
    const quotes = received.map(({ response, receivedAt }, index) => {
      const tier = EXECUTABLE_NOTIONALS_USD[index];
      if (tier === undefined) throw new Error('Missing executable notional');
      return normalizeRaydiumQuote(response.data, market, tier, receivedAt, observedAt, poolInfo);
    });
    return {
      kind: 'routing',
      marketId: `raydium:${market.outputToken.symbol}-${market.inputToken.symbol}`,
      observedAt,
      inputAsset: market.inputToken,
      outputAsset: market.outputToken,
      quotes,
    };
  }

  getConfiguredCurves(): Promise<readonly RoutingExecutablePriceCurve[]> {
    return Promise.all(this.markets.map((market) => this.getCurve(market)));
  }

  clearCache(): void {
    this.quoteCache.clear();
    this.poolCache.clear();
  }

  private getQuote(market: JupiterMarketConfig, tier: ExecutableNotionalUsd): Promise<ReceivedQuote> {
    const amount = new Decimal(tier).mul(new Decimal(10).pow(market.inputToken.decimals)).toFixed(0);
    const key = `${market.inputToken.contractAddress}:${market.outputToken.contractAddress}:${amount}:${this.slippageBps}`;
    return this.quoteCache.getOrCreate(key, async () => {
      const url = new URL(this.quoteUrl);
      url.searchParams.set('inputMint', market.inputToken.contractAddress);
      url.searchParams.set('outputMint', market.outputToken.contractAddress);
      url.searchParams.set('amount', amount);
      url.searchParams.set('slippageBps', String(this.slippageBps));
      url.searchParams.set('txVersion', 'V0');
      const response = await this.getJson<RaydiumQuoteResponse>(url, 'quote');
      if (!response.success) throw new Error(`Raydium quote failed: ${response.msg ?? 'unknown error'}`);
      return { response, receivedAt: new Date(this.now()) };
    });
  }

  private getPools(poolIds: readonly string[]): Promise<RaydiumPoolInfoResponse> {
    const ids = [...poolIds].sort().join(',');
    if (ids === '') return Promise.resolve({ id: 'empty', success: true, data: [] });
    return this.poolCache.getOrCreate(ids, async () => {
      const url = new URL(this.poolInfoUrl);
      url.searchParams.set('ids', ids);
      const response = await this.getJson<RaydiumPoolInfoResponse>(url, 'pool info');
      if (!response.success) throw new Error(`Raydium pool info failed: ${response.msg ?? 'unknown error'}`);
      return response;
    });
  }

  private async getJson<T>(url: URL, operation: string): Promise<T> {
    await this.limiter.acquire();
    const response = await this.request(url);
    if (!response.ok) throw new Error(`Raydium ${operation} failed: HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
}
