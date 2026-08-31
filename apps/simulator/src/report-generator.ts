import { Decimal } from '@arbitrage-scanner/core';
import type { ReplayMetrics } from './replay-types.js';

/**
 * Thresholds for determining whether a shadow simulation passes the
 * go/no-go gate. These are conservative defaults that should be tuned
 * based on the specific strategy and risk tolerance.
 */
export interface GoNoGoThresholds {
  /** Minimum median net PnL in USD (must be positive). */
  readonly minMedianPnlUsd: Decimal.Value;
  /** Maximum acceptable 5th percentile loss (not currently computed per-run). */
  readonly maxTailLossUsd: Decimal.Value;
  /** Minimum win rate as a decimal fraction (e.g., 0.45 = 45%). */
  readonly minWinRate: Decimal.Value;
  /** Maximum drawdown as a percentage of inventory (e.g., 0.05 = 5%). */
  readonly maxDrawdownPct: Decimal.Value;
  /** Maximum gas-to-gross-profit ratio (e.g., 0.3 = 30%). */
  readonly maxGasToProfitRatio: Decimal.Value;
  /** Maximum acceptable trade failure rate (e.g., 0.10 = 10%). */
  readonly maxFailureRate: Decimal.Value;
}

/** Default conservative thresholds for S4 CEX-DEX arbitrage. */
export const DEFAULT_GO_NO_GO_THRESHOLDS: GoNoGoThresholds = {
  minMedianPnlUsd: '0',
  maxTailLossUsd: '-100',
  minWinRate: '0.40',
  maxDrawdownPct: '5',
  maxGasToProfitRatio: '0.40',
  maxFailureRate: '0.15',
};

/**
 * Result of the go/no-go evaluation.
 */
export interface GoNoGoResult {
  readonly passed: boolean;
  readonly checks: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly actual: string;
    readonly threshold: string;
  }[];
  readonly summary: string;
}

/**
 * Evaluates replay metrics against the go/no-go thresholds.
 */
export function evaluateGoNoGo(
  metrics: ReplayMetrics,
  thresholds: GoNoGoThresholds = DEFAULT_GO_NO_GO_THRESHOLDS,
): GoNoGoResult {
  const checks = [];

  // Check 1: Median PnL > 0
  const medianPnl = new Decimal(metrics.medianPnlUsd);
  const minMedian = new Decimal(thresholds.minMedianPnlUsd);
  checks.push({
    name: 'Median net PnL positive',
    passed: medianPnl.greaterThan(minMedian),
    actual: `$${medianPnl.toFixed(4)}`,
    threshold: `> $${minMedian.toFixed(2)}`,
  });

  // Check 2: Win rate
  const winRate = new Decimal(metrics.winRate);
  const minWinRate = new Decimal(thresholds.minWinRate);
  checks.push({
    name: 'Win rate above minimum',
    passed: winRate.greaterThanOrEqualTo(minWinRate),
    actual: `${winRate.mul(100).toFixed(1)}%`,
    threshold: `>= ${minWinRate.mul(100).toFixed(1)}%`,
  });

  // Check 3: Max drawdown
  const maxDd = new Decimal(metrics.maxDrawdownPct);
  const maxDdThreshold = new Decimal(thresholds.maxDrawdownPct);
  checks.push({
    name: 'Max drawdown within limit',
    passed: maxDd.lessThanOrEqualTo(maxDdThreshold),
    actual: `${maxDd.toFixed(2)}%`,
    threshold: `<= ${maxDdThreshold.toFixed(2)}%`,
  });

  // Check 4: Gas to profit ratio
  const gasRatio = new Decimal(metrics.gasToProfitRatio);
  const maxGasRatio = new Decimal(thresholds.maxGasToProfitRatio);
  checks.push({
    name: 'Gas cost ratio acceptable',
    passed: metrics.totalGrossProfitUsd.greaterThan(0)
      ? gasRatio.lessThanOrEqualTo(maxGasRatio)
      : false,
    actual: metrics.totalGrossProfitUsd.greaterThan(0)
      ? `${gasRatio.mul(100).toFixed(1)}%`
      : 'N/A (no gross profit)',
    threshold: `<= ${maxGasRatio.mul(100).toFixed(1)}%`,
  });

  // Check 5: Failure rate
  const failureRate = metrics.totalTrades > 0
    ? new Decimal(metrics.failedTrades).div(metrics.totalTrades)
    : new Decimal(0);
  const maxFailureRate = new Decimal(thresholds.maxFailureRate);
  checks.push({
    name: 'Trade failure rate acceptable',
    passed: failureRate.lessThanOrEqualTo(maxFailureRate),
    actual: `${failureRate.mul(100).toFixed(1)}%`,
    threshold: `<= ${maxFailureRate.mul(100).toFixed(1)}%`,
  });

  const allPassed = checks.every((check) => check.passed);
  const passedCount = checks.filter((check) => check.passed).length;
  const summary = allPassed
    ? `PASS: All ${checks.length} checks passed. Strategy may proceed to further validation.`
    : `FAIL: ${passedCount}/${checks.length} checks passed. Strategy should NOT enter live trading.`;

  return { passed: allPassed, checks, summary };
}

/**
 * Generates a Markdown report from replay metrics and go/no-go result.
 */
export function generateMarkdownReport(
  metrics: ReplayMetrics,
  goNoGo: GoNoGoResult,
  config: {
    readonly strategy: string;
    readonly pair: string;
    readonly period: string;
    readonly initialInventoryUsd: Decimal.Value;
  },
): string {
  const lines: string[] = [];

  lines.push(`# Shadow Simulation Report — ${config.strategy}`);
  lines.push('');
  lines.push(`**Pair:** ${config.pair}  `);
  lines.push(`**Period:** ${config.period}  `);
  lines.push(`**Initial Inventory:** $${new Decimal(config.initialInventoryUsd).toFixed(2)}  `);
  lines.push(`**Generated:** ${new Date().toISOString()}  `);
  lines.push('');

  // Go/No-Go verdict
  lines.push('## Verdict');
  lines.push('');
  lines.push(`### ${goNoGo.passed ? '✅ PASS' : '❌ FAIL'}`);
  lines.push('');
  lines.push(`> ${goNoGo.summary}`);
  lines.push('');

  lines.push('| Check | Result | Actual | Threshold |');
  lines.push('|-------|--------|--------|-----------|');
  for (const check of goNoGo.checks) {
    lines.push(`| ${check.name} | ${check.passed ? '✅' : '❌'} | ${check.actual} | ${check.threshold} |`);
  }
  lines.push('');

  // Executive summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`- **Total trades simulated:** ${metrics.totalTrades}`);
  lines.push(`- **Successful (both legs):** ${metrics.successfulTrades}`);
  lines.push(`- **Failed:** ${metrics.failedTrades}`);
  lines.push(`- **Win rate:** ${metrics.winRate.mul(100).toFixed(1)}%`);
  lines.push(`- **Total realized PnL:** $${metrics.totalRealizedPnlUsd.toFixed(4)}`);
  lines.push(`- **Average PnL per trade:** $${metrics.averagePnlUsd.toFixed(4)}`);
  lines.push(`- **Median PnL per trade:** $${metrics.medianPnlUsd.toFixed(4)}`);
  lines.push(`- **Max drawdown:** $${metrics.maxDrawdownUsd.toFixed(4)} (${metrics.maxDrawdownPct.toFixed(2)}%)`);
  lines.push('');

  // Cost breakdown
  lines.push('## Cost Breakdown');
  lines.push('');
  lines.push(`| Cost Component | Total (USD) | Per Trade (USD) |`);
  lines.push('|----------------|-------------|-----------------|');
  lines.push(`| Gross profit | $${metrics.totalGrossProfitUsd.toFixed(4)} | $${metrics.totalTrades > 0 ? metrics.totalGrossProfitUsd.div(metrics.totalTrades).toFixed(4) : '0'} |`);
  lines.push(`| CEX/DEX fees | $${metrics.totalFeesUsd.toFixed(4)} | $${metrics.totalTrades > 0 ? metrics.totalFeesUsd.div(metrics.totalTrades).toFixed(4) : '0'} |`);
  lines.push(`| Solana gas | $${metrics.totalGasUsd.toFixed(4)} | $${metrics.averageGasUsd.toFixed(4)} |`);
  lines.push(`| Unwind costs | $${metrics.totalUnwindCostsUsd.toFixed(4)} | $${metrics.totalTrades > 0 ? metrics.totalUnwindCostsUsd.div(metrics.totalTrades).toFixed(4) : '0'} |`);
  lines.push(`| **Net realized PnL** | **$${metrics.totalRealizedPnlUsd.toFixed(4)}** | **$${metrics.averagePnlUsd.toFixed(4)}** |`);
  lines.push('');
  lines.push(`- **Gas-to-gross-profit ratio:** ${metrics.gasToProfitRatio.mul(100).toFixed(1)}%`);
  lines.push(`- **Average effective latency:** ${metrics.averageLatencyMs.toFixed(0)} ms`);
  lines.push('');

  // Failure analysis
  lines.push('## Failure Analysis');
  lines.push('');
  lines.push(`- **CEX-only failures:** ${metrics.cexOnlyFailures}`);
  lines.push(`- **DEX-only failures:** ${metrics.dexOnlyFailures}`);
  lines.push(`- **Both legs failed:** ${metrics.bothFailures}`);
  lines.push(`- **Total failure rate:** ${metrics.totalTrades > 0 ? new Decimal(metrics.failedTrades).div(metrics.totalTrades).mul(100).toFixed(1) : '0'}%`);
  lines.push('');
  lines.push('> DEX-only failures are the most costly: the CEX leg executes but the on-chain transaction fails, requiring an unwind trade that incurs additional fees and slippage.');
  lines.push('');

  // PnL series (summary)
  if (metrics.pnlSeries.length > 0) {
    lines.push('## Cumulative PnL Timeline');
    lines.push('');
    const first = metrics.pnlSeries[0];
    const last = metrics.pnlSeries[metrics.pnlSeries.length - 1];
    if (first !== undefined && last !== undefined) {
      lines.push(`- **Start:** ${first.timestamp.toISOString()} → $${first.cumulativePnl.toFixed(4)}`);
      lines.push(`- **End:** ${last.timestamp.toISOString()} → $${last.cumulativePnl.toFixed(4)}`);
    }
    lines.push('');
  }

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');
  if (goNoGo.passed) {
    lines.push('1. Strategy passes the initial shadow simulation gate.');
    lines.push('2. Run additional Monte Carlo simulations (1000+ runs) to confirm PnL distribution stability.');
    lines.push('3. Test with higher-fidelity data (full order book depth, real Solana network state).');
    lines.push('4. Before live trading, implement a paper-trading mode with real order routing but no execution.');
  } else {
    lines.push('1. **Do NOT enter live trading.** The strategy fails one or more go/no-go checks.');
    lines.push('2. Investigate the failing checks above to identify root causes.');
    lines.push('3. Common issues to address:');
    lines.push('   - High gas costs: increase minimum trade size, optimize priority fee strategy.');
    lines.push('   - High failure rate: improve slippage settings, add retry logic, monitor network congestion.');
    lines.push('   - Low win rate: tighten entry thresholds, improve execution timing.');
    lines.push('   - Large drawdowns: implement position sizing limits and circuit breakers.');
    lines.push('4. Re-run shadow simulation after adjustments before reconsidering live trading.');
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('*This report was generated by the Arbitrage Scanner shadow simulation engine. Phase 1 is read-only; no real trades were executed.*');

  return lines.join('\n');
}

/**
 * Generates a simple HTML report from replay metrics.
 * Suitable for dashboard embedding or email delivery.
 */
export function generateHtmlReport(
  metrics: ReplayMetrics,
  goNoGo: GoNoGoResult,
  config: {
    readonly strategy: string;
    readonly pair: string;
    readonly period: string;
  },
): string {
  const verdictColor = goNoGo.passed ? '#22c55e' : '#ef4444';
  const verdictText = goNoGo.passed ? 'PASS' : 'FAIL';

  const checksHtml = goNoGo.checks.map((check) => `
    <tr>
      <td>${check.name}</td>
      <td style="color: ${check.passed ? '#22c55e' : '#ef4444'}">${check.passed ? '✓' : '✗'}</td>
      <td>${check.actual}</td>
      <td>${check.threshold}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shadow Simulation Report — ${config.strategy}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1f2937; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { font-size: 18px; margin-top: 32px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    .verdict { font-size: 32px; font-weight: bold; color: ${verdictColor}; padding: 16px; background: ${verdictColor}15; border-radius: 8px; text-align: center; margin: 16px 0; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0; }
    .metric { background: #f9fafb; padding: 12px; border-radius: 6px; }
    .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    .metric-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    .positive { color: #22c55e; }
    .negative { color: #ef4444; }
  </style>
</head>
<body>
  <h1>Shadow Simulation Report</h1>
  <p><strong>Strategy:</strong> ${config.strategy} | <strong>Pair:</strong> ${config.pair} | <strong>Period:</strong> ${config.period}</p>

  <div class="verdict">${verdictText}</div>
  <p style="text-align: center; color: #6b7280;">${goNoGo.summary}</p>

  <h2>Go/No-Go Checks</h2>
  <table>
    <thead><tr><th>Check</th><th>Result</th><th>Actual</th><th>Threshold</th></tr></thead>
    <tbody>${checksHtml}</tbody>
  </table>

  <h2>Key Metrics</h2>
  <div class="summary">
    <div class="metric"><div class="metric-label">Total Trades</div><div class="metric-value">${metrics.totalTrades}</div></div>
    <div class="metric"><div class="metric-label">Win Rate</div><div class="metric-value">${metrics.winRate.mul(100).toFixed(1)}%</div></div>
    <div class="metric"><div class="metric-label">Net PnL</div><div class="metric-value ${metrics.totalRealizedPnlUsd.greaterThan(0) ? 'positive' : 'negative'}">$${metrics.totalRealizedPnlUsd.toFixed(2)}</div></div>
    <div class="metric"><div class="metric-label">Avg PnL/Trade</div><div class="metric-value">$${metrics.averagePnlUsd.toFixed(4)}</div></div>
    <div class="metric"><div class="metric-label">Max Drawdown</div><div class="metric-value negative">${metrics.maxDrawdownPct.toFixed(2)}%</div></div>
    <div class="metric"><div class="metric-label">Gas/Profit Ratio</div><div class="metric-value">${metrics.gasToProfitRatio.mul(100).toFixed(1)}%</div></div>
  </div>

  <h2>Cost Breakdown</h2>
  <table>
    <thead><tr><th>Component</th><th>Total (USD)</th><th>Per Trade (USD)</th></tr></thead>
    <tbody>
      <tr><td>Gross Profit</td><td>$${metrics.totalGrossProfitUsd.toFixed(4)}</td><td>$${metrics.totalTrades > 0 ? metrics.totalGrossProfitUsd.div(metrics.totalTrades).toFixed(4) : '0'}</td></tr>
      <tr><td>Fees</td><td>$${metrics.totalFeesUsd.toFixed(4)}</td><td>$${metrics.totalTrades > 0 ? metrics.totalFeesUsd.div(metrics.totalTrades).toFixed(4) : '0'}</td></tr>
      <tr><td>Solana Gas</td><td>$${metrics.totalGasUsd.toFixed(4)}</td><td>$${metrics.averageGasUsd.toFixed(4)}</td></tr>
      <tr><td>Unwind Costs</td><td>$${metrics.totalUnwindCostsUsd.toFixed(4)}</td><td>$${metrics.totalTrades > 0 ? metrics.totalUnwindCostsUsd.div(metrics.totalTrades).toFixed(4) : '0'}</td></tr>
      <tr style="font-weight: bold;"><td>Net Realized PnL</td><td>$${metrics.totalRealizedPnlUsd.toFixed(4)}</td><td>$${metrics.averagePnlUsd.toFixed(4)}</td></tr>
    </tbody>
  </table>

  <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">Generated by Arbitrage Scanner shadow simulation engine. Phase 1 read-only.</p>
</body>
</html>`;
}
