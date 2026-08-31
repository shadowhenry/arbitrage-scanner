import type { Opportunity, OrderBook } from '@arbitrage-scanner/core';

export type { Opportunity } from '@arbitrage-scanner/core';
export * from './arbitrage-graph.js';
export * from './basis-arbitrage.js';
export * from './binary-complete-set.js';
export * from './funding-arbitrage.js';

export interface Strategy {
  readonly id: string;
  evaluate(books: readonly OrderBook[]): readonly Opportunity[];
}
