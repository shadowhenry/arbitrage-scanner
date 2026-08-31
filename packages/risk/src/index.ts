import type { Opportunity } from '@arbitrage-scanner/strategies';

export interface RiskDecision {
  readonly accepted: boolean;
  readonly reason?: string;
}

export interface RiskPolicy {
  evaluate(opportunity: Opportunity): RiskDecision;
}

// Shadow simulation cost models (Phase 1: read-only execution quality assessment)
export * from './sim-types.js';
export * from './sim-gas-model.js';
export * from './sim-failure-model.js';
export * from './sim-inventory.js';
export * from './sim-latency-model.js';

