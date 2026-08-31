import { describe, expect, it, vi } from 'vitest';
import { HyperliquidAdapter } from './adapter.js';

describe('HyperliquidAdapter', () => {
  it('discovers requested perp and available spot markets and normalizes live state', async () => {
    const requestInfo = async <T>(payload: object): Promise<T> => {
      if ('type' in payload && payload.type === 'metaAndAssetCtxs') {
        return [
          { universe: [{ name: 'BTC', szDecimals: 5 }, { name: 'ETH', szDecimals: 4 }] },
          [
            { funding: '0.0001', markPx: '100', oraclePx: '100.1' },
            { funding: '0.0002', markPx: '200', oraclePx: '200.1' },
          ],
        ] as unknown as T;
      }
      return [
        {
          tokens: [
            { name: 'USDC', szDecimals: 6, weiDecimals: 6, index: 0, tokenId: 'usdc' },
            { name: 'BTC', szDecimals: 5, weiDecimals: 8, index: 1, tokenId: 'btc' },
          ],
          universe: [{ name: '@0', tokens: [1, 0], index: 0 }],
        },
        [{ markPx: '100.2' }],
      ] as unknown as T;
    };
    const onState = vi.fn();
    const adapter = new HyperliquidAdapter({
      perpAssets: ['BTC'], spotAssets: ['BTC'], requestInfo, onState, staleAfterMs: 5_000,
    });
    await adapter.initialize();

    adapter.handleMessage(JSON.stringify({
      channel: 'l2Book', data: {
        coin: 'BTC', time: 1_000,
        levels: [[{ px: '99', sz: '2', n: 1 }], [{ px: '101', sz: '2', n: 1 }]],
      },
    }));
    adapter.handleMessage(JSON.stringify({
      channel: 'activeAssetCtx', data: {
        coin: 'BTC', ctx: { funding: '0.0003', markPx: '100.3', oraclePx: '100.4' },
      },
    }));
    adapter.handleMessage(JSON.stringify({
      channel: 'l2Book', data: {
        coin: '@0', time: 1_000,
        levels: [[{ px: '98', sz: '1', n: 1 }], [{ px: '102', sz: '1', n: 1 }]],
      },
    }));

    const perp = adapter.getState('BTC', Date.now());
    const spot = adapter.getState('@0', 1_100);
    expect(perp?.kind).toBe('perpetual');
    if (perp?.kind === 'perpetual') {
      expect(perp.market.markPrice.toString()).toBe('100.3');
      expect(perp.market.indexPrice.toString()).toBe('100.4');
      expect(perp.fundingRate.hourlyRate.toString()).toBe('0.0003');
    }
    expect(spot?.kind).toBe('spot');
    if (spot?.kind === 'spot') expect(spot.quote.symbol).toBe('BTC/USDC');
    expect(onState).toHaveBeenCalled();
  });

  it('normalizes historical funding returned by the info API', async () => {
    const requestInfo = async <T>(): Promise<T> => ([
      { coin: 'SOL', fundingRate: '0.0001', premium: '0', time: 1_000 },
    ] as unknown as T);
    const adapter = new HyperliquidAdapter({ perpAssets: [], requestInfo, onState: vi.fn() });
    const history = await adapter.getHistoricalFunding('SOL', 0, 2_000);
    expect(history[0]?.hourlyRate.toString()).toBe('0.0001');
    expect(history[0]?.annualizedRate.toString()).toBe('0.876');
  });
});
