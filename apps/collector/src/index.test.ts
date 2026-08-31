import { describe, expect, it } from 'vitest';
import { collectorHealth } from './index.js';

describe('collector health', () => {
  it('reports ok', () => expect(collectorHealth().status).toBe('ok'));
});

