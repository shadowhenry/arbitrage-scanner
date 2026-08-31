import {
  Decimal,
  type ExecutableLiquiditySource,
  type ExecutableNotionalUsd,
  type ExecutableRoutePoint,
} from '@arbitrage-scanner/core';
import type { JupiterMarketConfig } from '../jupiter/types.js';
import type { RaydiumPoolInfo, RaydiumQuoteData } from './types.js';

function amountFromAtomic(atomic: string, decimals: number): Decimal {
  const amount = new Decimal(atomic);
  if (!amount.isInteger() || !amount.greaterThan(0)) throw new TypeError('Token amount must be positive atomic units');
  return amount.div(new Decimal(10).pow(decimals));
}

export function normalizeRaydiumQuote(
  quote: RaydiumQuoteData,
  market: JupiterMarketConfig,
  notionalUsd: ExecutableNotionalUsd,
  quoteTimestamp: Date,
  observedAt: Date,
  poolInfo: ReadonlyMap<string, RaydiumPoolInfo>,
): ExecutableRoutePoint {
  if (quote.swapType !== 'BaseIn') throw new TypeError('Raydium quote must use BaseIn');
  if (quote.inputMint !== market.inputToken.contractAddress) throw new TypeError('Unexpected input mint');
  if (quote.outputMint !== market.outputToken.contractAddress) throw new TypeError('Unexpected output mint');
  const inputAmount = amountFromAtomic(quote.inputAmount, market.inputToken.decimals);
  const outputAmount = amountFromAtomic(quote.outputAmount, market.outputToken.decimals);
  const priceImpact = new Decimal(quote.priceImpactPct);
  if (!priceImpact.isFinite() || priceImpact.isNegative()) throw new TypeError('Invalid priceImpactPct');

  const route = quote.routePlan.map((step) => ({
    ammKey: step.poolId,
    dexLabel: 'Raydium',
    inputMint: step.inputMint,
    outputMint: step.outputMint,
    ...(step.inputAmount === undefined ? {} : { inputAmountAtomic: step.inputAmount }),
    ...(step.outputAmount === undefined ? {} : { outputAmountAtomic: step.outputAmount }),
    ...(step.feeAmount === undefined ? {} : { feeAmountAtomic: step.feeAmount }),
    ...(step.feeMint === undefined ? {} : { feeMint: step.feeMint }),
    percent: new Decimal(100),
  }));
  const pools: ExecutableLiquiditySource[] = [...new Set(quote.routePlan.map((step) => step.poolId))]
    .map((poolId) => {
      const info = poolInfo.get(poolId);
      return {
        poolId,
        ...(info?.type === undefined ? {} : { poolType: info.type }),
        liquidityUsd: new Decimal(info?.tvl ?? 0),
      };
    });

  return {
    notionalUsd,
    inputAmount,
    outputAmount,
    effectivePrice: inputAmount.div(outputAmount),
    priceImpact,
    route,
    dexLabels: ['Raydium'],
    quoteTimestamp,
    pools,
    liquidityUsd: pools.reduce((sum, pool) => sum.plus(pool.liquidityUsd), new Decimal(0)),
    quoteAgeMs: Math.max(0, observedAt.getTime() - quoteTimestamp.getTime()),
  };
}
