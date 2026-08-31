import { describe, expect, it, vi } from 'vitest';
import { fetchHyperliquidFundingHistory } from './info.js';
import type { HyperliquidFundingHistoryRecord } from './types.js';

describe('funding history pagination', () => {
  it('paginates 500-record responses without duplicating the cursor', async () => {
    const first = Array.from({ length: 500 }, (_, index): HyperliquidFundingHistoryRecord => ({
      coin: 'BTC', fundingRate: '0.0001', premium: '0', time: index + 1,
    }));
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([{ coin: 'BTC', fundingRate: '0.0002', premium: '0', time: 501 }]);

    const result = await fetchHyperliquidFundingHistory('BTC', 1, 1_000, request);
    expect(result).toHaveLength(501);
    expect(request).toHaveBeenNthCalledWith(2, {
      type: 'fundingHistory', coin: 'BTC', startTime: 501, endTime: 1_000,
    });
  });
});

