import type { BinaryPredictionMarketSnapshot } from '@arbitrage-scanner/core';
import { TtlPromiseCache } from '../src/cache.js';
import { SlidingWindowRateLimiter } from '../src/rate-limit.js';
import { normalizeClobBook, normalizeGammaMarket, normalizePolymarketFee } from './normalize.js';
import type {
  ClobFeeRateResponse,
  ClobMarketInfoResponse,
  ClobOrderBookResponse,
  DiscoverMarketsOptions,
  DiscoveredPolymarketMarket,
  GammaMarketResponse,
  PolymarketAdapterOptions,
  PolymarketVenueAdapter,
} from './types.js';

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class PolymarketAdapter implements PolymarketVenueAdapter {
  private readonly gammaUrl: string;
  private readonly clobUrl: string;
  private readonly request: NonNullable<PolymarketAdapterOptions['fetch']>;
  private readonly now: () => number;
  private readonly cache: TtlPromiseCache<unknown>;
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(options: PolymarketAdapterOptions = {}) {
    this.gammaUrl = options.gammaUrl ?? 'https://gamma-api.polymarket.com';
    this.clobUrl = options.clobUrl ?? 'https://clob.polymarket.com';
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.cache = new TtlPromiseCache(options.cacheTtlMs ?? 5_000, options.cacheMaxEntries ?? 1_000, this.now);
    this.limiter = new SlidingWindowRateLimiter(
      options.rateLimitRequests ?? 100, options.rateLimitIntervalMs ?? 1_000,
      this.now, options.sleep ?? wait,
    );
  }

  async discoverMarkets(options: DiscoverMarketsOptions = {}): Promise<readonly DiscoveredPolymarketMarket[]> {
    const url = new URL('/markets', this.gammaUrl);
    url.searchParams.set('limit', String(options.limit ?? 100));
    url.searchParams.set('offset', String(options.offset ?? 0));
    url.searchParams.set('active', String(options.active ?? true));
    url.searchParams.set('closed', String(options.closed ?? false));
    const raw = await this.cachedJson<readonly GammaMarketResponse[]>(url.toString(), url);
    const observedAt = new Date(this.now());
    return raw
      .filter((market) => market.enableOrderBook !== false && market.clobTokenIds !== '')
      .flatMap((market) => {
        try { return [normalizeGammaMarket(market, observedAt)]; } catch { return []; }
      });
  }

  async getBinarySnapshot(market: DiscoveredPolymarketMarket): Promise<BinaryPredictionMarketSnapshot> {
    const booksUrl = new URL('/books', this.clobUrl);
    const books = await this.cachedJson<readonly ClobOrderBookResponse[]>(
      `books:${market.yesTokenId}:${market.noTokenId}`,
      booksUrl,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([
        { token_id: market.yesTokenId }, { token_id: market.noTokenId },
      ]) },
    );
    const yesRaw = books.find((book) => book.asset_id === market.yesTokenId);
    const noRaw = books.find((book) => book.asset_id === market.noTokenId);
    if (yesRaw === undefined || noRaw === undefined) throw new Error('Polymarket returned incomplete binary orderbooks');
    const [yesBaseFee, noBaseFee, marketInfo] = await Promise.all([
      this.getFeeRate(market.yesTokenId), this.getFeeRate(market.noTokenId), this.getMarketInfo(market.market.id),
    ]);
    const observedAt = new Date(this.now());
    const scheduledRate = marketInfo.fd?.r ?? market.feeSchedule?.rate;
    const exponent = marketInfo.fd?.e ?? market.feeSchedule?.exponent ?? 1;
    return {
      market: market.market,
      yesOrderBook: normalizeClobBook(yesRaw, market.market, 'YES'),
      noOrderBook: normalizeClobBook(noRaw, market.market, 'NO'),
      yesFee: normalizePolymarketFee(market.yesTokenId, yesBaseFee, market.feesEnabled, observedAt, scheduledRate, exponent),
      noFee: normalizePolymarketFee(market.noTokenId, noBaseFee, market.feesEnabled, observedAt, scheduledRate, exponent),
    };
  }

  clearCache(): void { this.cache.clear(); }

  private async getFeeRate(tokenId: string): Promise<number> {
    const url = new URL('/fee-rate', this.clobUrl);
    url.searchParams.set('token_id', tokenId);
    const response = await this.cachedJson<ClobFeeRateResponse>(`fee:${tokenId}`, url);
    return response.base_fee;
  }

  private getMarketInfo(marketId: string): Promise<ClobMarketInfoResponse> {
    const conditionId = marketId.replace(/^polymarket:/, '');
    const url = new URL(`/clob-markets/${encodeURIComponent(conditionId)}`, this.clobUrl);
    return this.cachedJson<ClobMarketInfoResponse>(`market-info:${conditionId}`, url);
  }

  private cachedJson<T>(key: string, url: URL, init?: RequestInit): Promise<T> {
    return this.cache.getOrCreate(key, async () => {
      await this.limiter.acquire();
      const response = await this.request(url, init);
      if (!response.ok) throw new Error(`Polymarket request failed: HTTP ${response.status}`);
      return response.json() as Promise<T>;
    }) as Promise<T>;
  }
}
