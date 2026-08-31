import type { Decimal } from '@arbitrage-scanner/core';
import type {
  ArbitrageDirection,
  ExecutionResult,
  GasCostBreakdown,
  InventoryState,
  LatencySample,
} from '@arbitrage-scanner/risk';

/** A single market data event in the replay timeline. */
export type ReplayEvent =
  | { readonly type: 'binance-orderbook'; readonly timestamp: Date; readonly payload: BinanceOrderBookSnapshot }
  | { readonly type: 'jupiter-quote'; readonly timestamp: Date; readonly payload: JupiterQuoteSnapshot };

/** Binance order book snapshot at a point in time. */
export interface BinanceOrderBookSnapshot {
  readonly symbol: string;
  readonly bids: readonly { readonly price: string; readonly quantity: string }[];
  readonly asks: readonly { readonly price: string; readonly quantity: string }[];
  readonly observedAt: Date;
}

/** Jupiter routing quote snapshot at a point in time. */
export interface JupiterQuoteSnapshot {
  readonly direction: 'buy' | 'sell';
  readonly notionalUsd: number;
  readonly inputAmount: string;
  readonly outputAmount: string;
  readonly effectivePrice: string;
  readonly priceImpact: string;
  readonly observedAt: Date;
}

/** Result of simulating a single arbitrage opportunity execution. */
export interface SimulatedTrade {
  readonly id: string;
  readonly timestamp: Date;
  readonly strategyId: 'S4';
  readonly direction: ArbitrageDirection;
  readonly notionalUsd: Decimal;
  readonly grossProfitUsd: Decimal;
  readonly entryFeesUsd: Decimal;
  readonly gasCost: GasCostBreakdown;
  readonly latency: LatencySample;
  readonly execution: ExecutionResult;
  readonly inventoryBefore: InventoryState;
  readonly inventoryAfter?: InventoryState;
  readonly realizedPnlUsd: Decimal;
  readonly netEdgeBps: Decimal;
  readonly failureReason?: string;
  readonly unwindCostUsd?: Decimal;
}

/** Aggregated metrics from a replay run. */
export interface ReplayMetrics {
  readonly totalTrades: number;
  readonly successfulTrades: number;
  readonly failedTrades: number;
  readonly cexOnlyFailures: number;
  readonly dexOnlyFailures: number;
  readonly bothFailures: number;
  readonly totalGrossProfitUsd: Decimal;
  readonly totalFeesUsd: Decimal;
  readonly totalGasUsd: Decimal;
  readonly totalUnwindCostsUsd: Decimal;
  readonly totalRealizedPnlUsd: Decimal;
  readonly averagePnlUsd: Decimal;
  readonly medianPnlUsd: Decimal;
  readonly winRate: Decimal;
  readonly maxDrawdownUsd: Decimal;
  readonly maxDrawdownPct: Decimal;
  readonly averageLatencyMs: number;
  readonly averageGasUsd: Decimal;
  readonly gasToProfitRatio: Decimal;
  readonly pnlSeries: readonly { readonly timestamp: Date; readonly cumulativePnl: Decimal }[];
}

/** Configuration for a replay run. */
export interface ReplayConfig {
  readonly initialInventory: InventoryState;
  readonly solPriceUsd: Decimal.Value;
  readonly minProfitThresholdUsd: Decimal.Value;
  readonly gasPriorityFeeMicroLamports: number;
  readonly randomSeed?: number;
}

/** Current state of the replay engine. */
export interface ReplayState {
  readonly currentTime: Date;
  readonly inventory: InventoryState;
  readonly trades: readonly SimulatedTrade[];
  readonly cumulativePnl: Decimal;
  readonly peakPnl: Decimal;
  readonly maxDrawdownUsd: Decimal;
}
