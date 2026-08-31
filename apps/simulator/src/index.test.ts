import { describe, expect, it } from 'vitest';
import { simulatorHealth } from './index.js';

describe('simulator health', () => {
  it('confirms read-only execution', () => {
    expect(simulatorHealth()).toMatchObject({ status: 'ok', executionMode: 'read-only' });
  });
});

