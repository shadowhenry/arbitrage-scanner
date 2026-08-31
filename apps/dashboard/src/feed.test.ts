import { describe, expect, it } from 'vitest';
import { demoSnapshot } from './mock-data.js';
import { applyDashboardMessage } from './feed.js';

describe('dashboard WebSocket reducer', () => {
  it('upserts and removes opportunity messages without mutating the previous snapshot', () => {
    const replacement = { ...demoSnapshot.opportunities[0]!, expectedProfitUsd: 999 };
    const next = applyDashboardMessage(demoSnapshot, { type: 'opportunity.upsert', data: replacement });
    expect(next.opportunities[0]?.expectedProfitUsd).toBe(999);
    expect(demoSnapshot.opportunities[0]?.expectedProfitUsd).not.toBe(999);
    const removed = applyDashboardMessage(next, { type: 'opportunity.remove', id: replacement.id });
    expect(removed.opportunities.some((item) => item.id === replacement.id)).toBe(false);
  });
});
