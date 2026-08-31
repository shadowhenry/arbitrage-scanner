import { Decimal } from '@arbitrage-scanner/core';
import {
  applyTrade,
  calculateGasCost,
  canExecute,
  DEFAULT_GAS_CONFIG,
  simulateExecutionOutcome,
  simulateLatencyAndDrift,
  type ArbitrageDirection,
  type FailureModelConfig,
  type GasModelConfig,
  type InventoryState,
  type LatencyModelConfig,
  type RandomSource,
} from '@arbitrage-scanner/risk';
import type {
  BinanceOrderBookSnapshot,
  JupiterQuoteSnapshot,
  ReplayConfig,
  ReplayEvent,
  ReplayMetrics,
  ReplayState,
  SimulatedTrade,
} from './replay-types.js';

/**
 * Deterministic pseudo-random number generator (mulberry32).
 * Used for reproducible replay runs with a fixed seed.
 */
function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_FAILURE_CONFIG: FailureModelConfig = {
  cexFailureRate: '0.002',
  dexFailureRate: '0.025',
  cexPartialFillRate: '0.005',
  unwindCostUsd: '5.00',
};

const DEFAULT_LATENCY_CONFIG: LatencyModelConfig = {
  cexLatencyMinMs: 50,
  cexLatencyMaxMs: 200,
  dexLatencyMinMs: 400,
  dexLatencyMaxMs: 2000,
  solVolatilityPerSecond: '0.0004',
};

/**
 * Event-driven replay engine for CEX-DEX arbitrage shadow simulation.
 *
 * The engine processes a timeline of market data events, maintains current
 * order book and DEX quote state, detects S4 arbitrage opportunities, and
 * simulates execution with realistic costs:
 * - CEX and DEX taker fees
 * - Solana gas and priority fees
 * - Execution latency and price drift
 * - Trade failure probability and unwind costs
 * - Pre-funded inventory constraints
 *
 * All randomness is deterministic given a seed, enabling reproducible runs.
 */
export class ReplayEngine {
  private readonly events: readonly ReplayEvent[];
  private readonly config: ReplayConfig;
  private readonly random: RandomSource;

  private binanceBook: BinanceOrderBookSnapshot | null = null;
  private jupiterBuyQuotes = new Map<number, JupiterQuoteSnapshot>();
  private jupiterSellQuotes = new Map<number, JupiterQuoteSnapshot>();

  private inventory: InventoryState;
  private trades: SimulatedTrade[] = [];
  private cumulativePnl = new Decimal(0);
  private peakPnl = new Decimal(0);
  private maxDrawdownUsd = new Decimal(0);
  private currentTime = new Date(0);
  private tradeCounter = 0;

  constructor(events: readonly ReplayEvent[], config: ReplayConfig) {
    this.events = [...events].sort((a, b) =>
      a.timestamp.getTime() - b.timestamp.getTime());
    this.config = config;
    this.inventory = config.initialInventory;
    this.random = mulberry32(config.randomSeed ?? Date.now());
  }

  /**
   * Runs the full replay and returns aggregated metrics.
   */
  run(): ReplayMetrics {
    for (const event of this.events) {
      this.processEvent(event);
    }
    return this.computeMetrics();
  }

  /**
   * Returns the current replay state (for incremental inspection).
   */
  getState(): ReplayState {
    return {
      currentTime: this.currentTime,
      inventory: this.inventory,
      trades: this.trades,
      cumulativePnl: this.cumulativePnl,
      peakPnl: this.peakPnl,
      maxDrawdownUsd: this.maxDrawdownUsd,
    };
  }

  private processEvent(event: ReplayEvent): void {
    this.currentTime = event.timestamp;

    if (event.type === 'binance-orderbook') {
      this.binanceBook = event.payload;
    } else if (event.type === 'jupiter-quote') {
      const map = event.payload.direction === 'buy'
        ? this.jupiterBuyQuotes
        : this.jupiterSellQuotes;
      map.set(event.payload.notionalUsd, event.payload);
    }

    // After updating market data, attempt to detect and execute opportunities
    this.tryDetectAndExecute();
  }

  private tryDetectAndExecute(): void {
    if (this.binanceBook === null) return;

    const binanceMid = this.getBinanceMidPrice();
    if (binanceMid === null) return;

    // Check both directions for each capital bucket
    const buckets = [100, 500, 1000, 2500, 5000, 10000, 25000];

    for (const notional of buckets) {
      // Direction 1: Buy on Binance, Sell on Jupiter (cex-buy-dex-sell)
      this.tryExecuteDirection('cex-buy-dex-sell', notional);

      // Direction 2: Buy on Jupiter, Sell on Binance (dex-buy-cex-sell)
      this.tryExecuteDirection('dex-buy-cex-sell', notional);
    }
  }

  private tryExecuteDirection(
    direction: ArbitrageDirection,
    notionalUsd: number,
  ): void {
    const jupiterQuote = direction === 'cex-buy-dex-sell'
      ? this.jupiterSellQuotes.get(notionalUsd)
      : this.jupiterBuyQuotes.get(notionalUsd);

    if (jupiterQuote === undefined) return;

    const jupiterPrice = new Decimal(jupiterQuote.effectivePrice);
    const notional = new Decimal(notionalUsd);

    // Calculate gross profit (simplified: price difference × notional / price)
    // For cex-buy-dex-sell: buy at Binance ask, sell at Jupiter bid
    // For dex-buy-cex-sell: buy at Jupiter ask, sell at Binance bid
    const binanceSide = direction === 'cex-buy-dex-sell' ? 'ask' : 'bid';
    const binancePrice = this.getBinancePrice(binanceSide);
    if (binancePrice === null) return;

    const solQuantity = notional.div(binancePrice);

    // Gross profit = |jupiterPrice - binancePrice| × solQuantity
    // But direction matters: we buy at the lower price and sell at the higher
    let grossProfit: Decimal;
    if (direction === 'cex-buy-dex-sell') {
      // Buy at Binance, sell at Jupiter. Profit if Jupiter > Binance.
      grossProfit = jupiterPrice.minus(binancePrice).mul(solQuantity);
    } else {
      // Buy at Jupiter, sell at Binance. Profit if Binance > Jupiter.
      grossProfit = binancePrice.minus(jupiterPrice).mul(solQuantity);
    }

    // Skip if no gross profit
    if (!grossProfit.greaterThan(0)) return;

    // Skip if below minimum threshold
    const minThreshold = new Decimal(this.config.minProfitThresholdUsd);
    if (grossProfit.lessThan(minThreshold)) return;

    // Check inventory
    if (!canExecute(this.inventory, direction, notional, solQuantity)) return;

    // Simulate execution
    this.executeTrade(direction, notional, solQuantity, grossProfit);
  }

  private executeTrade(
    direction: ArbitrageDirection,
    notional: Decimal,
    solQuantity: Decimal,
    grossProfit: Decimal,
  ): void {
    this.tradeCounter += 1;
    const timestamp = this.currentTime;
    const inventoryBefore = { ...this.inventory };

    // Calculate gas cost
    const gasConfig: GasModelConfig = {
      ...DEFAULT_GAS_CONFIG,
      solPriceUsd: this.config.solPriceUsd,
      priorityFeeMicroLamports: this.config.gasPriorityFeeMicroLamports,
    };
    const gasCost = calculateGasCost(gasConfig);

    // Simulate latency and price drift
    const latency = simulateLatencyAndDrift(DEFAULT_LATENCY_CONFIG, this.random);

    // Simulate execution outcome
    const execution = simulateExecutionOutcome(DEFAULT_FAILURE_CONFIG, this.random);

    // Calculate entry fees (simplified: 0.1% CEX + implicit DEX)
    const cexFee = notional.mul('0.001');
    const entryFeesUsd = cexFee;

    // Calculate realized PnL
    let realizedPnl = grossProfit.minus(entryFeesUsd).minus(gasCost.totalUsd);
    let inventoryAfter: InventoryState | undefined;

    if (execution.bothExecuted) {
      // Both legs executed — apply trade to inventory
      inventoryAfter = applyTrade(this.inventory, direction, notional, solQuantity);
      this.inventory = inventoryAfter;
    } else {
      // One or both legs failed — add unwind cost
      if (execution.unwindCostUsd !== undefined) {
        realizedPnl = realizedPnl.minus(execution.unwindCostUsd);
      }
      // Inventory unchanged (or partially changed, simplified: no change)
    }

    // Update cumulative PnL and drawdown
    this.cumulativePnl = this.cumulativePnl.plus(realizedPnl);
    if (this.cumulativePnl.greaterThan(this.peakPnl)) {
      this.peakPnl = this.cumulativePnl;
    }
    const drawdown = this.peakPnl.minus(this.cumulativePnl);
    if (drawdown.greaterThan(this.maxDrawdownUsd)) {
      this.maxDrawdownUsd = drawdown;
    }

    const netEdgeBps = realizedPnl.div(notional).mul(10_000);

    const trade: SimulatedTrade = {
      id: `sim-s4-${this.tradeCounter}`,
      timestamp,
      strategyId: 'S4',
      direction,
      notionalUsd: notional,
      grossProfitUsd: grossProfit,
      entryFeesUsd,
      gasCost,
      latency,
      execution,
      inventoryBefore,
      ...(inventoryAfter === undefined ? {} : { inventoryAfter }),
      realizedPnlUsd: realizedPnl,
      netEdgeBps,
      ...(execution.failureReason === undefined ? {} : { failureReason: execution.failureReason }),
      ...(execution.unwindCostUsd === undefined ? {} : { unwindCostUsd: execution.unwindCostUsd }),
    };

    this.trades.push(trade);
  }

  private getBinanceMidPrice(): Decimal | null {
    if (this.binanceBook === null) return null;
    const bestBid = this.binanceBook.bids[0];
    const bestAsk = this.binanceBook.asks[0];
    if (bestBid === undefined || bestAsk === undefined) return null;
    return new Decimal(bestBid.price).plus(bestAsk.price).div(2);
  }

  private getBinancePrice(side: 'bid' | 'ask'): Decimal | null {
    if (this.binanceBook === null) return null;
    const level = side === 'bid' ? this.binanceBook.bids[0] : this.binanceBook.asks[0];
    if (level === undefined) return null;
    return new Decimal(level.price);
  }

  private computeMetrics(): ReplayMetrics {
    const trades = this.trades;
    const totalTrades = trades.length;
    const successfulTrades = trades.filter((t) => t.execution.bothExecuted).length;
    const failedTrades = totalTrades - successfulTrades;
    const cexOnlyFailures = trades.filter((t) =>
      !t.execution.bothExecuted
      && t.execution.cexOutcome !== 'executed'
      && t.execution.dexOutcome === 'executed').length;
    const dexOnlyFailures = trades.filter((t) =>
      !t.execution.bothExecuted
      && t.execution.cexOutcome === 'executed'
      && t.execution.dexOutcome !== 'executed').length;
    const bothFailures = trades.filter((t) =>
      !t.execution.bothExecuted
      && t.execution.cexOutcome !== 'executed'
      && t.execution.dexOutcome !== 'executed').length;

    const totalGrossProfit = trades.reduce((sum, t) => sum.plus(t.grossProfitUsd), new Decimal(0));
    const totalFees = trades.reduce((sum, t) => sum.plus(t.entryFeesUsd), new Decimal(0));
    const totalGas = trades.reduce((sum, t) => sum.plus(t.gasCost.totalUsd), new Decimal(0));
    const totalUnwindCosts = trades.reduce(
      (sum, t) => sum.plus(t.unwindCostUsd ?? new Decimal(0)), new Decimal(0));
    const totalRealizedPnl = trades.reduce((sum, t) => sum.plus(t.realizedPnlUsd), new Decimal(0));

    const averagePnl = totalTrades > 0 ? totalRealizedPnl.div(totalTrades) : new Decimal(0);
    const sortedPnls = trades.map((t) => t.realizedPnlUsd).sort((a, b) => a.comparedTo(b));
    const medianPnl = sortedPnls.length > 0
      ? sortedPnls[Math.floor(sortedPnls.length / 2)] ?? new Decimal(0)
      : new Decimal(0);

    const winningTrades = trades.filter((t) => t.realizedPnlUsd.greaterThan(0)).length;
    const winRate = totalTrades > 0 ? new Decimal(winningTrades).div(totalTrades) : new Decimal(0);

    const totalInventoryValue = this.inventory.cexUsdc
      .plus(this.inventory.chainUsdc)
      .plus(this.inventory.cexSol.plus(this.inventory.chainSol).mul(this.config.solPriceUsd));
    const maxDrawdownPct = totalInventoryValue.greaterThan(0)
      ? this.maxDrawdownUsd.div(totalInventoryValue).mul(100)
      : new Decimal(0);

    const averageLatencyMs = trades.length > 0
      ? trades.reduce((sum, t) => sum + t.latency.effectiveLatencyMs, 0) / trades.length
      : 0;
    const averageGasUsd = trades.length > 0
      ? totalGas.div(trades.length)
      : new Decimal(0);
    const gasToProfitRatio = totalGrossProfit.greaterThan(0)
      ? totalGas.div(totalGrossProfit)
      : new Decimal(0);

    // Build cumulative PnL series
    let running = new Decimal(0);
    const pnlSeries = trades.map((t) => {
      running = running.plus(t.realizedPnlUsd);
      return { timestamp: t.timestamp, cumulativePnl: running };
    });

    return {
      totalTrades,
      successfulTrades,
      failedTrades,
      cexOnlyFailures,
      dexOnlyFailures,
      bothFailures,
      totalGrossProfitUsd: totalGrossProfit,
      totalFeesUsd: totalFees,
      totalGasUsd: totalGas,
      totalUnwindCostsUsd: totalUnwindCosts,
      totalRealizedPnlUsd: totalRealizedPnl,
      averagePnlUsd: averagePnl,
      medianPnlUsd: medianPnl,
      winRate,
      maxDrawdownUsd: this.maxDrawdownUsd,
      maxDrawdownPct,
      averageLatencyMs,
      averageGasUsd,
      gasToProfitRatio,
      pnlSeries,
    };
  }
}
