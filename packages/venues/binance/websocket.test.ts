import { describe, expect, it } from 'vitest';
import { calculateReconnectDelay } from './websocket.js';

describe('reconnect backoff', () => {
  it('uses bounded exponential backoff with jitter', () => {
    expect(calculateReconnectDelay(0, 500, 30_000, () => 0)).toBe(250);
    expect(calculateReconnectDelay(2, 500, 30_000, () => 1)).toBe(2_000);
    expect(calculateReconnectDelay(20, 500, 30_000, () => 1)).toBe(30_000);
  });
});

