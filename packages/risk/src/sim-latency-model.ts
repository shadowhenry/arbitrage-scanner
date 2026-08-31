import { Decimal } from '@arbitrage-scanner/core';
import type { LatencyModelConfig, LatencySample, RandomSource } from './sim-types.js';

/**
 * Default latency assumptions for CEX-DEX arbitrage:
 * - CEX: 50-200ms round-trip (REST API order + confirmation)
 * - DEX: 400-2000ms (transaction send + Solana confirmation)
 * - SOL volatility: ~0.0004 per second (≈ 3.5% daily, reasonable for SOL)
 */
export const DEFAULT_LATENCY_CONFIG: Readonly<LatencyModelConfig> = {
  cexLatencyMinMs: 50,
  cexLatencyMaxMs: 200,
  dexLatencyMinMs: 400,
  dexLatencyMaxMs: 2_000,
  solVolatilityPerSecond: '0.0004',
};

function validateConfig(config: LatencyModelConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (key === 'solVolatilityPerSecond') continue;
    const num = value as number;
    if (!Number.isFinite(num) || num < 0) {
      throw new RangeError(`${key} must be a non-negative finite number`);
    }
  }
  if (config.cexLatencyMaxMs < config.cexLatencyMinMs) {
    throw new RangeError('cexLatencyMaxMs must be >= cexLatencyMinMs');
  }
  if (config.dexLatencyMaxMs < config.dexLatencyMinMs) {
    throw new RangeError('dexLatencyMaxMs must be >= dexLatencyMinMs');
  }
  const volatility = new Decimal(config.solVolatilityPerSecond);
  if (!volatility.isFinite() || volatility.isNegative()) {
    throw new RangeError('solVolatilityPerSecond must be a non-negative finite decimal');
  }
}

function defaultRandom(): number {
  return Math.random();
}

/**
 * Samples a uniform random value between min and max.
 */
function sampleUniform(min: number, max: number, random: RandomSource): number {
  if (min === max) return min;
  return min + random() * (max - min);
}

/**
 * Approximates the inverse normal CDF (quantile function) using the
 * Acklam algorithm. Accurate to ~1e-9 for most of the distribution.
 * Used to sample price drift from a normal distribution.
 */
function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new RangeError('p must be strictly between 0 and 1');
  }

  const a: readonly [number, number, number, number, number, number] = [
    -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00,
  ];
  const b: readonly [number, number, number, number, number] = [
    -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c: readonly [number, number, number, number, number, number] = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00,
  ];
  const d: readonly [number, number, number, number] = [
    7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number;
  let r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
    / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Samples a standard normal random variable using the inverse transform
 * method with a uniform random source.
 */
function sampleStandardNormal(random: RandomSource): number {
  // Avoid exact 0 or 1 which would cause infinite quantiles
  const p = Math.min(Math.max(random(), 1e-10), 1 - 1e-10);
  return inverseNormalCdf(p);
}

/**
 * Simulates execution latency and the resulting price drift for a CEX-DEX
 * arbitrage opportunity.
 *
 * The model assumes:
 * 1. CEX and DEX latencies are independently uniformly distributed
 * 2. The effective latency is the maximum of both (both must settle)
 * 3. During the latency window, SOL price follows a geometric Brownian
 *    motion with the configured volatility per second
 * 4. Price drift is sampled from a normal distribution with standard
 *    deviation = volatility × √(latency_seconds)
 *
 * The price multiplier is (1 + drift_fraction), which can be applied to
 * both legs' execution prices to simulate adverse or favorable movement.
 *
 * @param config Latency and volatility configuration
 * @param random Optional random source for deterministic testing
 * @returns Sampled latencies and price drift
 */
export function simulateLatencyAndDrift(
  config: LatencyModelConfig = DEFAULT_LATENCY_CONFIG,
  random: RandomSource = defaultRandom,
): LatencySample {
  validateConfig(config);

  const cexLatencyMs = sampleUniform(
    config.cexLatencyMinMs,
    config.cexLatencyMaxMs,
    random,
  );
  const dexLatencyMs = sampleUniform(
    config.dexLatencyMinMs,
    config.dexLatencyMaxMs,
    random,
  );
  const effectiveLatencyMs = Math.max(cexLatencyMs, dexLatencyMs);
  const latencySeconds = effectiveLatencyMs / 1000;

  const volatilityPerSecond = new Decimal(config.solVolatilityPerSecond);
  const stdDeviation = volatilityPerSecond.mul(Math.sqrt(latencySeconds));

  // When volatility or latency is zero, drift is exactly zero.
  // Skip normal sampling to avoid -0 from 0 * negative z-score.
  let driftFraction: Decimal;
  if (stdDeviation.isZero()) {
    driftFraction = new Decimal(0);
  } else {
    const zScore = sampleStandardNormal(random);
    driftFraction = stdDeviation.mul(zScore);
  }

  const priceDriftBps = driftFraction.mul(10_000);
  const priceMultiplier = new Decimal(1).plus(driftFraction);

  return {
    cexLatencyMs,
    dexLatencyMs,
    effectiveLatencyMs,
    priceDriftBps,
    priceMultiplier,
  };
}

/**
 * Applies a price drift multiplier to an execution price.
 * Positive drift means the price moved up (adverse for buys, favorable for sells).
 * Negative drift means the price moved down (favorable for buys, adverse for sells).
 */
export function applyPriceDrift(
  executionPrice: Decimal.Value,
  priceMultiplier: Decimal.Value,
): Decimal {
  const price = new Decimal(executionPrice);
  const multiplier = new Decimal(priceMultiplier);
  if (!price.isFinite() || !price.greaterThan(0)) {
    throw new RangeError('executionPrice must be a positive finite decimal');
  }
  if (!multiplier.isFinite() || multiplier.lessThanOrEqualTo(0)) {
    throw new RangeError('priceMultiplier must be a positive finite decimal');
  }
  return price.mul(multiplier);
}

/**
 * Estimates the expected absolute price drift in basis points for a given
 * latency and volatility. This is the expected magnitude (not signed) of
 * the price move, useful for sizing slippage buffers.
 */
export function expectedDriftBps(
  latencyMs: number,
  volatilityPerSecond: Decimal.Value,
): Decimal {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    throw new RangeError('latencyMs must be a non-negative finite number');
  }
  const volatility = new Decimal(volatilityPerSecond);
  if (!volatility.isFinite() || volatility.isNegative()) {
    throw new RangeError('volatilityPerSecond must be a non-negative finite decimal');
  }
  const latencySeconds = latencyMs / 1000;
  // Expected absolute value of a normal variable = σ × √(2/π)
  const sqrtTwoOverPi = Math.sqrt(2 / Math.PI);
  return volatility
    .mul(Math.sqrt(latencySeconds))
    .mul(sqrtTwoOverPi)
    .mul(10_000);
}
