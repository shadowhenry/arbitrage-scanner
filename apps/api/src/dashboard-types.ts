export type StrategyId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';

export interface OpportunityRow {
  readonly id: string;
  readonly asset: string;
  readonly strategy: StrategyId;
  readonly buyVenue: string;
  readonly sellVenue: string;
  readonly grossEdgeBps: number;
  readonly netEdgeBps: number;
  readonly capacityUsd: number;
  readonly expectedProfitUsd: number;
  readonly returnOnCapital: number;
  readonly duration: string;
  readonly detectedAt: string;
  readonly capitalBucketUsd: number;
  readonly buyVwap: number;
  readonly sellVwap: number;
  readonly feesUsd: number;
  readonly slippageUsd: number;
  readonly fundingProfitUsd: number;
  readonly history: readonly { readonly time: string; readonly edgeBps: number }[];
}

export interface DashboardMetrics {
  readonly opportunitiesToday: number;
  readonly simulatedProfitToday: number;
  readonly bestOpportunity: string;
  readonly medianNetEdgeBps: number;
  readonly capitalUtilization: number;
}

export interface FundingRow {
  readonly asset: string;
  readonly binance: number;
  readonly bybit: number;
  readonly hyperliquid: number;
  readonly bestSpreadBps: number;
}

export interface MarketRow {
  readonly symbol: string;
  readonly venue: string;
  readonly type: string;
  readonly bid: number;
  readonly ask: number;
  readonly spreadBps: number;
  readonly depth25k: number;
  readonly ageMs: number;
  readonly status: 'healthy' | 'stale';
}

export interface SimulationRow {
  readonly id: string;
  readonly name: string;
  readonly period: string;
  readonly trades: number;
  readonly pnlUsd: number;
  readonly winRate: number;
  readonly maxDrawdown: number;
  readonly status: 'running' | 'completed';
}

export interface StrategyPerformanceRow {
  readonly strategy: StrategyId;
  readonly name: string;
  readonly opportunities: number;
  readonly simulatedTrades: number;
  readonly pnlUsd: number;
  readonly avgEdgeBps: number;
  readonly utilization: number;
}

export interface DashboardSnapshot {
  readonly metrics: DashboardMetrics;
  readonly opportunities: readonly OpportunityRow[];
  readonly funding: readonly FundingRow[];
  readonly markets: readonly MarketRow[];
  readonly simulations: readonly SimulationRow[];
  readonly strategies: readonly StrategyPerformanceRow[];
}

export type DashboardMessage =
  | { readonly type: 'snapshot'; readonly data: DashboardSnapshot }
  | { readonly type: 'opportunity.upsert'; readonly data: OpportunityRow }
  | { readonly type: 'opportunity.remove'; readonly id: string }
  | { readonly type: 'metrics'; readonly data: DashboardMetrics }
  | { readonly type: 'funding'; readonly data: readonly FundingRow[] }
  | { readonly type: 'markets'; readonly data: readonly MarketRow[] }
  | { readonly type: 'simulations'; readonly data: readonly SimulationRow[] }
  | { readonly type: 'strategies'; readonly data: readonly StrategyPerformanceRow[] };
