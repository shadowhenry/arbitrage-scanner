import type {
  DashboardMetrics,
  DashboardMessage,
  DashboardSnapshot,
  FundingRow,
  MarketRow,
  OpportunityRow,
  SimulationRow,
  StrategyPerformanceRow,
} from './dashboard-types.js';

type SnapshotListener = (message: DashboardMessage) => void;

const EMPTY_SNAPSHOT: DashboardSnapshot = {
  metrics: {
    opportunitiesToday: 0,
    simulatedProfitToday: 0,
    bestOpportunity: '—',
    medianNetEdgeBps: 0,
    capitalUtilization: 0,
  },
  opportunities: [],
  funding: [],
  markets: [],
  simulations: [],
  strategies: [],
};

/**
 * Manages the in-memory dashboard snapshot and supports incremental updates.
 * Listeners are notified whenever any part of the snapshot changes.
 */
export class DashboardState {
  private snapshot: DashboardSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly opportunityHistory = new Map<string, OpportunityRow>();

  getSnapshot(): DashboardSnapshot {
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    // Send full snapshot immediately on subscribe
    listener({ type: 'snapshot', data: this.snapshot });
    return () => this.listeners.delete(listener);
  }

  private broadcast(message: DashboardMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch {
        // Ignore listener errors
      }
    }
  }

  setSnapshot(snapshot: DashboardSnapshot): void {
    this.snapshot = snapshot;
    this.broadcast({ type: 'snapshot', data: snapshot });
  }

  upsertOpportunity(opportunity: OpportunityRow): void {
    this.opportunityHistory.set(opportunity.id, opportunity);
    const opportunities = [...this.snapshot.opportunities];
    const index = opportunities.findIndex((o) => o.id === opportunity.id);
    if (index >= 0) {
      opportunities[index] = opportunity;
    } else {
      opportunities.push(opportunity);
    }
    // Keep top 100 by expected profit
    opportunities.sort((a, b) => b.expectedProfitUsd - a.expectedProfitUsd);
    const trimmed = opportunities.slice(0, 100);
    this.snapshot = { ...this.snapshot, opportunities: trimmed };
    this.broadcast({ type: 'opportunity.upsert', data: opportunity });
    this.updateMetricsFromOpportunities();
  }

  removeOpportunity(id: string): void {
    this.opportunityHistory.delete(id);
    const opportunities = this.snapshot.opportunities.filter((o) => o.id !== id);
    this.snapshot = { ...this.snapshot, opportunities };
    this.broadcast({ type: 'opportunity.remove', id });
    this.updateMetricsFromOpportunities();
  }

  updateMetrics(metrics: DashboardMetrics): void {
    this.snapshot = { ...this.snapshot, metrics };
    this.broadcast({ type: 'metrics', data: metrics });
  }

  updateFunding(funding: readonly FundingRow[]): void {
    this.snapshot = { ...this.snapshot, funding };
    this.broadcast({ type: 'funding', data: funding });
  }

  updateMarkets(markets: readonly MarketRow[]): void {
    this.snapshot = { ...this.snapshot, markets };
    this.broadcast({ type: 'markets', data: markets });
  }

  updateSimulations(simulations: readonly SimulationRow[]): void {
    this.snapshot = { ...this.snapshot, simulations };
    this.broadcast({ type: 'simulations', data: simulations });
  }

  updateStrategies(strategies: readonly StrategyPerformanceRow[]): void {
    this.snapshot = { ...this.snapshot, strategies };
    this.broadcast({ type: 'strategies', data: strategies });
  }

  private updateMetricsFromOpportunities(): void {
    const opportunities = this.snapshot.opportunities;
    if (opportunities.length === 0) return;
    const sortedEdges = [...opportunities].map((o) => o.netEdgeBps).sort((a, b) => a - b);
    const median = sortedEdges[Math.floor(sortedEdges.length / 2)] ?? 0;
    const best = opportunities[0];
    const metrics: DashboardMetrics = {
      ...this.snapshot.metrics,
      bestOpportunity: best !== undefined
        ? `${best.asset} · ${best.strategy} · ${best.netEdgeBps.toFixed(1)} bps`
        : '—',
      medianNetEdgeBps: median,
    };
    this.snapshot = { ...this.snapshot, metrics };
    this.broadcast({ type: 'metrics', data: metrics });
  }

  clear(): void {
    this.opportunityHistory.clear();
    this.setSnapshot(EMPTY_SNAPSHOT);
  }
}
