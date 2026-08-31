import { describe, expect, it } from 'vitest';
import { scannerHealth } from './index.js';

describe('scanner health', () => {
  it('reports ok', () => expect(scannerHealth().status).toBe('ok'));
});

