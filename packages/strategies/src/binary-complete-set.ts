import {
  Decimal,
  type BinaryPredictionMarketSnapshot,
  type Opportunity,
  type OrderBookLevel,
  type PredictionFeeInformation,
} from '@arbitrage-scanner/core';

export const BINARY_ARBITRAGE_CAPITAL_USD = [100, 500, 1_000, 2_500, 5_000] as const;
export type BinaryArbitrageCapitalUsd = (typeof BINARY_ARBITRAGE_CAPITAL_USD)[number];

export interface BinaryCompleteSetConfig {
  readonly slippageBufferBps?: Decimal.Value;
  readonly maxDataAgeMs?: number;
  readonly now?: Date;
}

export interface BinaryCompleteSetOpportunity extends Opportunity {
  readonly strategyId: 'S6';
  readonly conditionId: string;
  readonly question: string;
  readonly requestedCapitalUsd: BinaryArbitrageCapitalUsd;
  readonly executableCapitalUsd: Decimal;
  readonly executableShares: Decimal;
  readonly availableExecutableShares: Decimal;
  readonly availableExecutableCapacityUsd: Decimal;
  readonly yesCostUsd: Decimal;
  readonly noCostUsd: Decimal;
  readonly yesVwap: Decimal;
  readonly noVwap: Decimal;
  readonly feeUsd: Decimal;
  readonly feePerShare: Decimal;
  readonly slippageBufferUsd: Decimal;
  readonly slippageBufferPerShare: Decimal;
  readonly allInCostPerShare: Decimal;
  readonly redemptionValueUsd: Decimal;
}

interface PairedFill {
  readonly shares: Decimal;
  readonly yesCost: Decimal;
  readonly noCost: Decimal;
  readonly fees: Decimal;
  readonly buffer: Decimal;
  readonly allInCost: Decimal;
}

function feePerShare(price: Decimal, fee: PredictionFeeInformation): Decimal {
  return fee.enabled
    ? fee.takerFeeRate.mul(price.mul(new Decimal(1).minus(price)).pow(fee.exponent))
    : new Decimal(0);
}

function pairedFill(
  yesAsks: readonly OrderBookLevel[],
  noAsks: readonly OrderBookLevel[],
  yesFee: PredictionFeeInformation,
  noFee: PredictionFeeInformation,
  bufferRate: Decimal,
  budget?: Decimal,
): PairedFill {
  let yesIndex = 0;
  let noIndex = 0;
  let yesRemaining = yesAsks[0]?.quantity ?? new Decimal(0);
  let noRemaining = noAsks[0]?.quantity ?? new Decimal(0);
  let remainingBudget = budget;
  let shares = new Decimal(0);
  let yesCost = new Decimal(0);
  let noCost = new Decimal(0);
  let fees = new Decimal(0);
  let buffer = new Decimal(0);

  while (yesIndex < yesAsks.length && noIndex < noAsks.length) {
    const yes = yesAsks[yesIndex];
    const no = noAsks[noIndex];
    if (yes === undefined || no === undefined) break;
    const tranche = Decimal.min(yesRemaining, noRemaining);
    const marginalFee = feePerShare(yes.price, yesFee).plus(feePerShare(no.price, noFee));
    const marginalBuffer = yes.price.plus(no.price).mul(bufferRate);
    const allInPerShare = yes.price.plus(no.price).plus(marginalFee).plus(marginalBuffer);
    const affordable = remainingBudget === undefined
      ? tranche
      : Decimal.min(tranche, remainingBudget.div(allInPerShare));
    if (!affordable.greaterThan(0)) break;
    shares = shares.plus(affordable);
    yesCost = yesCost.plus(affordable.mul(yes.price));
    noCost = noCost.plus(affordable.mul(no.price));
    fees = fees.plus(affordable.mul(marginalFee));
    buffer = buffer.plus(affordable.mul(marginalBuffer));
    remainingBudget = remainingBudget?.minus(affordable.mul(allInPerShare));
    yesRemaining = yesRemaining.minus(affordable);
    noRemaining = noRemaining.minus(affordable);
    if (yesRemaining.isZero()) {
      yesIndex += 1;
      yesRemaining = yesAsks[yesIndex]?.quantity ?? new Decimal(0);
    }
    if (noRemaining.isZero()) {
      noIndex += 1;
      noRemaining = noAsks[noIndex]?.quantity ?? new Decimal(0);
    }
    if (affordable.lessThan(tranche)) break;
  }
  return { shares, yesCost, noCost, fees, buffer, allInCost: yesCost.plus(noCost).plus(fees).plus(buffer) };
}

function conditionId(snapshot: BinaryPredictionMarketSnapshot): string {
  return snapshot.market.id.replace(/^polymarket:/, '');
}

export function scanBinaryCompleteSetArbitrage(
  snapshots: readonly BinaryPredictionMarketSnapshot[],
  config: BinaryCompleteSetConfig = {},
): readonly BinaryCompleteSetOpportunity[] {
  const now = config.now ?? new Date();
  const maxAgeMs = config.maxDataAgeMs ?? 10_000;
  const bufferRate = new Decimal(config.slippageBufferBps ?? 0).div(10_000);
  if (!bufferRate.isFinite() || bufferRate.isNegative()) throw new RangeError('slippageBufferBps must be non-negative');
  const opportunities: BinaryCompleteSetOpportunity[] = [];

  for (const snapshot of snapshots) {
    const oldest = Math.min(
      snapshot.market.observedAt.getTime(), snapshot.yesOrderBook.observedAt.getTime(),
      snapshot.noOrderBook.observedAt.getTime(), snapshot.yesFee.observedAt.getTime(),
      snapshot.noFee.observedAt.getTime(),
    );
    if (now.getTime() - oldest > maxAgeMs) continue;
    const capacity = pairedFill(
      snapshot.yesOrderBook.asks, snapshot.noOrderBook.asks,
      snapshot.yesFee, snapshot.noFee, bufferRate,
    );
    if (!capacity.shares.greaterThan(0)) continue;

    for (const capital of BINARY_ARBITRAGE_CAPITAL_USD) {
      const fill = pairedFill(
        snapshot.yesOrderBook.asks, snapshot.noOrderBook.asks,
        snapshot.yesFee, snapshot.noFee, bufferRate, new Decimal(capital),
      );
      if (!fill.shares.greaterThan(0)) continue;
      const yesVwap = fill.yesCost.div(fill.shares);
      const noVwap = fill.noCost.div(fill.shares);
      const feePerCompleteSet = fill.fees.div(fill.shares);
      const bufferPerCompleteSet = fill.buffer.div(fill.shares);
      const allInCostPerShare = fill.allInCost.div(fill.shares);
      if (!allInCostPerShare.lessThan(1)) continue;
      const redemptionValueUsd = fill.shares;
      const expectedProfitUsd = redemptionValueUsd.minus(fill.allInCost);
      opportunities.push({
        id: `S6:${conditionId(snapshot)}:${capital}`,
        strategyId: 'S6',
        conditionId: conditionId(snapshot),
        question: snapshot.market.question,
        requestedCapitalUsd: capital,
        executableCapitalUsd: fill.allInCost,
        executableShares: fill.shares,
        availableExecutableShares: capacity.shares,
        availableExecutableCapacityUsd: capacity.allInCost,
        yesCostUsd: fill.yesCost,
        noCostUsd: fill.noCost,
        yesVwap,
        noVwap,
        feeUsd: fill.fees,
        feePerShare: feePerCompleteSet,
        slippageBufferUsd: fill.buffer,
        slippageBufferPerShare: bufferPerCompleteSet,
        allInCostPerShare,
        redemptionValueUsd,
        notionalUsd: fill.allInCost,
        expectedProfitUsd,
        expectedEdgeBps: expectedProfitUsd.div(fill.allInCost).mul(10_000),
        legs: [
          { side: 'buy', marketId: snapshot.yesOrderBook.market.id, price: yesVwap, baseQuantity: fill.shares },
          { side: 'buy', marketId: snapshot.noOrderBook.market.id, price: noVwap, baseQuantity: fill.shares },
        ],
        observedAt: new Date(oldest),
      });
    }
  }
  return opportunities.sort((left, right) => right.expectedEdgeBps.comparedTo(left.expectedEdgeBps));
}
