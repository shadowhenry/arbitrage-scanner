import type { Decimal } from '@arbitrage-scanner/core';

/** Which leg of a CEX-DEX arbitrage is being simulated. */
export type ArbitrageDirection = 'cex-buy-dex-sell' | 'dex-buy-cex-sell';

/** Outcome of a single leg's execution attempt. */
export type LegOutcome = 'executed' | 'failed' | 'partial';

/** Reason a leg failed or partially filled. */
export type FailureReason =
  | 'insufficient-inventory'
  | 'slippage-exceeded'
  | 'network-timeout'
  | 'priority-fee-insufficient'
  | 'cex-order-rejected'
  | 'cex-partial-fill'
  | 'dex-rpc-error'
  | 'unknown';

/** Result of sampling execution outcomes for both legs. */
export interface ExecutionResult {
  readonly cexOutcome: LegOutcome;
  readonly dexOutcome: LegOutcome;
  /** True only when both legs fully executed. */
  readonly bothExecuted: boolean;
  readonly failureReason?: FailureReason;
  /** If a leg failed, the cost of unwinding the surviving leg. */
  readonly unwindCostUsd?: Decimal;
}

/** Pre-funded inventory on both venues. */
export interface InventoryState {
  readonly cexUsdc: Decimal;
  readonly cexSol: Decimal;
  readonly chainUsdc: Decimal;
  readonly chainSol: Decimal;
}

/** Target allocation for rebalance decisions. Ratios accept any decimal-like value. */
export interface InventoryTarget {
  readonly cexUsdcRatio: Decimal.Value;
  readonly cexSolRatio: Decimal.Value;
  readonly chainUsdcRatio: Decimal.Value;
  readonly chainSolRatio: Decimal.Value;
}

/** Snapshot of inventory after a trade or rebalance, mark-to-market. */
export interface InventorySnapshot {
  readonly state: InventoryState;
  readonly totalValueUsd: Decimal;
  readonly solPriceUsd: Decimal;
  readonly observedAt: Date;
}

/** Configuration for the Solana gas / priority-fee model. */
export interface GasModelConfig {
  /** Base fee in lamports per signature (Solana default: 5000). */
  readonly baseFeeLamports: number;
  /** Estimated compute units consumed by a Jupiter swap. */
  readonly computeUnits: number;
  /** Priority fee in micro-lamports per compute unit. */
  readonly priorityFeeMicroLamports: number;
  /** SOL price in USD for converting lamports to USD. */
  readonly solPriceUsd: Decimal.Value;
}

/** Breakdown of on-chain transaction costs. */
export interface GasCostBreakdown {
  readonly baseFeeLamports: number;
  readonly priorityFeeLamports: number;
  readonly totalLamports: number;
  readonly totalSol: Decimal;
  readonly totalUsd: Decimal;
}

/** Configuration for the execution-failure probability model. */
export interface FailureModelConfig {
  /** Probability [0,1] that the CEX leg fails or only partially fills. */
  readonly cexFailureRate: Decimal.Value;
  /** Probability [0,1] that the on-chain leg fails. */
  readonly dexFailureRate: Decimal.Value;
  /** Probability [0,1] that a CEX order only partially fills. */
  readonly cexPartialFillRate: Decimal.Value;
  /** Estimated cost (USD) of unwinding a single surviving leg. */
  readonly unwindCostUsd: Decimal.Value;
}

/** Configuration for execution-latency and price-drift simulation. */
export interface LatencyModelConfig {
  /** Minimum CEX round-trip latency in milliseconds. */
  readonly cexLatencyMinMs: number;
  /** Maximum CEX round-trip latency in milliseconds. */
  readonly cexLatencyMaxMs: number;
  /** Minimum on-chain confirmation latency in milliseconds. */
  readonly dexLatencyMinMs: number;
  /** Maximum on-chain confirmation latency in milliseconds. */
  readonly dexLatencyMaxMs: number;
  /** SOL price volatility per second (standard deviation of log returns). */
  readonly solVolatilityPerSecond: Decimal.Value;
}

/** Sampled latency and resulting price drift for one execution. */
export interface LatencySample {
  readonly cexLatencyMs: number;
  readonly dexLatencyMs: number;
  /** Effective latency = max(cex, dex) since both must settle. */
  readonly effectiveLatencyMs: number;
  /** Price drift in basis points (can be positive or negative). */
  readonly priceDriftBps: Decimal;
  /** Drift multiplier applied to the execution price (1 + drift). */
  readonly priceMultiplier: Decimal;
}

/** Random number generator interface for deterministic testing. */
export interface RandomSource {
  (): number;
}
