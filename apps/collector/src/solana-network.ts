/**
 * Solana network state collector.
 *
 * Polls Solana RPC endpoints for network health metrics:
 * - Block time and TPS
 * - Priority fee percentiles (for gas cost estimation)
 * - Congestion score (derived from block fullness and fee levels)
 *
 * This data is used by the simulation engine to dynamically adjust
 * gas cost and failure probability assumptions based on real network conditions.
 */

export interface SolanaNetworkState {
  readonly observedAt: Date;
  readonly blockHeight?: number;
  readonly recentBlockTimeMs?: number;
  readonly tps?: number;
  readonly priorityFeeP25MicroLamports?: number;
  readonly priorityFeeP50MicroLamports?: number;
  readonly priorityFeeP75MicroLamports?: number;
  readonly priorityFeeP95MicroLamports?: number;
  readonly estimatedComputeUnits?: number;
  readonly congestionScore?: number;
  readonly rawData?: Record<string, unknown>;
}

export interface SolanaCollectorConfig {
  /** Solana RPC endpoint URL. */
  readonly rpcUrl: string;
  /** Polling interval in milliseconds. */
  readonly pollIntervalMs?: number;
  /** Number of recent blocks to average for block time/TPS. */
  readonly blockWindowSize?: number;
  /** Optional API key for Helius/QuickNode etc. */
  readonly apiKey?: string;
  /** Callback for each collected state snapshot. */
  readonly onState?: (state: SolanaNetworkState) => void;
  /** Error callback. */
  readonly onError?: (error: Error) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_BLOCK_WINDOW_SIZE = 30;
const DEFAULT_COMPUTE_UNITS = 400_000;

/**
 * Collects Solana network health metrics at a configured interval.
 */
export class SolanaNetworkCollector {
  private readonly config: SolanaCollectorConfig;
  private readonly rpcUrl: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private latestState: SolanaNetworkState | null = null;
  private stopped = false;

  constructor(config: SolanaCollectorConfig) {
    this.config = config;
    this.rpcUrl = config.apiKey !== undefined
      ? `${config.rpcUrl}?api-key=${config.apiKey}`
      : config.rpcUrl;
  }

  /**
   * Starts the periodic collection loop.
   */
  start(): void {
    if (this.timer !== null) return;
    this.stopped = false;
    const interval = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    // Initial collection
    void this.collect();

    this.timer = setInterval(() => {
      if (!this.stopped) void this.collect();
    }, interval);
  }

  /**
   * Stops the collection loop.
   */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Returns the most recently collected network state.
   */
  getLatestState(): SolanaNetworkState | null {
    return this.latestState;
  }

  private async collect(): Promise<void> {
    try {
      const state = await this.fetchNetworkState();
      this.latestState = state;
      this.config.onState?.(state);
    } catch (error) {
      this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async fetchNetworkState(): Promise<SolanaNetworkState> {
    const observedAt = new Date();
    const [blockTimeResult, priorityFeeResult] = await Promise.allSettled([
      this.fetchBlockMetrics(),
      this.fetchPriorityFees(),
    ]);

    let blockHeight: number | undefined;
    let recentBlockTimeMs: number | undefined;
    let tps: number | undefined;

    if (blockTimeResult.status === 'fulfilled') {
      blockHeight = blockTimeResult.value.blockHeight;
      recentBlockTimeMs = blockTimeResult.value.recentBlockTimeMs;
      tps = blockTimeResult.value.tps;
    }

    let priorityFeeP25: number | undefined;
    let priorityFeeP50: number | undefined;
    let priorityFeeP75: number | undefined;
    let priorityFeeP95: number | undefined;

    if (priorityFeeResult.status === 'fulfilled') {
      priorityFeeP25 = priorityFeeResult.value.p25;
      priorityFeeP50 = priorityFeeResult.value.p50;
      priorityFeeP75 = priorityFeeResult.value.p75;
      priorityFeeP95 = priorityFeeResult.value.p95;
    }

    const congestionScore = this.calculateCongestionScore({
      recentBlockTimeMs,
      tps,
      priorityFeeP50,
      priorityFeeP95,
    });

    return {
      observedAt,
      ...(blockHeight === undefined ? {} : { blockHeight }),
      ...(recentBlockTimeMs === undefined ? {} : { recentBlockTimeMs }),
      ...(tps === undefined ? {} : { tps }),
      ...(priorityFeeP25 === undefined ? {} : { priorityFeeP25MicroLamports: priorityFeeP25 }),
      ...(priorityFeeP50 === undefined ? {} : { priorityFeeP50MicroLamports: priorityFeeP50 }),
      ...(priorityFeeP75 === undefined ? {} : { priorityFeeP75MicroLamports: priorityFeeP75 }),
      ...(priorityFeeP95 === undefined ? {} : { priorityFeeP95MicroLamports: priorityFeeP95 }),
      estimatedComputeUnits: DEFAULT_COMPUTE_UNITS,
      ...(congestionScore === undefined ? {} : { congestionScore }),
    };
  }

  private async fetchBlockMetrics(): Promise<{
    readonly blockHeight: number;
    readonly recentBlockTimeMs: number;
    readonly tps: number;
  }> {
    const windowSize = this.config.blockWindowSize ?? DEFAULT_BLOCK_WINDOW_SIZE;

    // Get current slot
    const slotResponse = await this.rpcCall('getSlot', []);
    const currentSlot = slotResponse as number;

    // Get recent blocks for time/TPS calculation
    const startSlot = Math.max(0, currentSlot - windowSize);
    const blocksResponse = await this.rpcCall('getBlocks', [startSlot, currentSlot]);
    const blocks = blocksResponse as number[];

    if (blocks.length < 2) {
      return { blockHeight: currentSlot, recentBlockTimeMs: 400, tps: 2000 };
    }

    // Get block times for first and last
    const firstBlock = blocks[0];
    const lastBlock = blocks[blocks.length - 1];
    if (firstBlock === undefined || lastBlock === undefined) {
      return { blockHeight: currentSlot, recentBlockTimeMs: 400, tps: 2000 };
    }

    const [firstTimeResult, lastTimeResult, lastBlockResult] = await Promise.all([
      this.rpcCall('getBlockTime', [firstBlock]),
      this.rpcCall('getBlockTime', [lastBlock]),
      this.rpcCall('getBlock', [lastBlock, { maxSupportedTransactionVersion: 0 }]),
    ]);

    const firstTime = firstTimeResult as number;
    const lastTime = lastTimeResult as number;
    const lastBlockData = lastBlockResult as { transactions?: unknown[] };

    const timeSpanMs = (lastTime - firstTime) * 1000;
    const blockCount = blocks.length;
    const recentBlockTimeMs = timeSpanMs / Math.max(1, blockCount);

    const txCount = lastBlockData.transactions?.length ?? 0;
    const tps = recentBlockTimeMs > 0 ? (txCount * 1000) / recentBlockTimeMs : 2000;

    return { blockHeight: currentSlot, recentBlockTimeMs, tps };
  }

  private async fetchPriorityFees(): Promise<{
    readonly p25: number;
    readonly p50: number;
    readonly p75: number;
    readonly p95: number;
  }> {
    // Use getRecentPrioritizationFees (available on most RPC nodes)
    const response = await this.rpcCall('getRecentPrioritizationFees', []);
    const fees = response as Array<{ slot: number; prioritizationFee: number }>;

    if (fees.length === 0) {
      // Default conservative values
      return { p25: 10_000, p50: 50_000, p75: 100_000, p95: 500_000 };
    }

    const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
    const percentile = (p: number): number => {
      const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
      return sorted[index] ?? 50_000;
    };

    return {
      p25: percentile(0.25),
      p50: percentile(0.50),
      p75: percentile(0.75),
      p95: percentile(0.95),
    };
  }

  private calculateCongestionScore(metrics: {
    readonly recentBlockTimeMs: number | undefined;
    readonly tps: number | undefined;
    readonly priorityFeeP50: number | undefined;
    readonly priorityFeeP95: number | undefined;
  }): number {
    let score = 0;

    // Block time > 600ms indicates congestion
    if (metrics.recentBlockTimeMs !== undefined) {
      if (metrics.recentBlockTimeMs > 800) score += 0.4;
      else if (metrics.recentBlockTimeMs > 600) score += 0.2;
    }

    // High priority fees indicate congestion
    if (metrics.priorityFeeP50 !== undefined) {
      if (metrics.priorityFeeP50 > 200_000) score += 0.3;
      else if (metrics.priorityFeeP50 > 100_000) score += 0.15;
    }

    // P95 much higher than P50 indicates spiky congestion
    if (metrics.priorityFeeP50 !== undefined && metrics.priorityFeeP95 !== undefined) {
      if (metrics.priorityFeeP50 > 0) {
        const ratio = metrics.priorityFeeP95 / metrics.priorityFeeP50;
        if (ratio > 10) score += 0.2;
        else if (ratio > 5) score += 0.1;
      }
    }

    return Math.min(1, score);
  }

  private async rpcCall(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Solana RPC ${method} failed: HTTP ${response.status}`);
    }

    const json = (await response.json()) as { result?: unknown; error?: unknown };
    if (json.error !== undefined) {
      throw new Error(`Solana RPC ${method} error: ${JSON.stringify(json.error)}`);
    }
    return json.result;
  }
}

/**
 * Converts a SolanaNetworkState to a database row for the
 * `solana_network_state` table.
 */
export function networkStateToRow(state: SolanaNetworkState): Record<string, unknown> {
  return {
    observed_at: state.observedAt,
    recent_block_time_ms: state.recentBlockTimeMs,
    block_height: state.blockHeight,
    tps: state.tps,
    priority_fee_p25_micro_lamports: state.priorityFeeP25MicroLamports,
    priority_fee_p50_micro_lamports: state.priorityFeeP50MicroLamports,
    priority_fee_p75_micro_lamports: state.priorityFeeP75MicroLamports,
    priority_fee_p95_micro_lamports: state.priorityFeeP95MicroLamports,
    estimated_compute_units: state.estimatedComputeUnits,
    congestion_score: state.congestionScore,
    raw_data: state.rawData,
  };
}
