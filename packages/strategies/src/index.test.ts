import { describe, expect, it } from 'vitest';
import type { Strategy } from './index.js';

describe('strategy contract', () => {
  it('supports a read-only strategy implementation', () => {
    const strategy: Strategy = { id: 'test', evaluate: () => [] };
    expect(strategy.evaluate([])).toEqual([]);
  });
});

