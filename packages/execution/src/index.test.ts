import { describe, expect, it } from 'vitest';
import { assertTradingDisabled, EXECUTION_MODE } from './index.js';

describe('execution safety boundary', () => {
  it('remains read-only', () => {
    expect(EXECUTION_MODE).toBe('read-only');
    expect(assertTradingDisabled).toThrow('disabled in Phase 1');
  });
});

