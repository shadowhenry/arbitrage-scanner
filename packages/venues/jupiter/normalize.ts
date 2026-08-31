import {
  Decimal,
  type ExecutableNotionalUsd,
  type ExecutableRoutePoint,
} from '@arbitrage-scanner/core';
import type { JupiterMarketConfig, JupiterQuoteResponse } from './types.js';

function tokenAmount(atomic: string, decimals: number, field: string): Decimal {
  const amount = new Decimal(atomic);
  if (!amount.isInteger() || amount.isNegative()) throw new TypeError(`${field} must be atomic units`);
  return amount.div(new Decimal(10).pow(decimals));
}

export function normalizeJupiterQuote(
  response: JupiterQuoteResponse,
  market: JupiterMarketConfig,
  notionalUsd: ExecutableNotionalUsd,
  quoteTimestamp: Date,
): ExecutableRoutePoint {
  if (response.swapMode !== 'ExactIn') throw new TypeError('Jupiter quote must use ExactIn');
  if (response.inputMint !== market.inputToken.contractAddress) throw new TypeError('Unexpected input mint');
  if (response.outputMint !== market.outputToken.contractAddress) throw new TypeError('Unexpected output mint');

  const inputAmount = tokenAmount(response.inAmount, market.inputToken.decimals, 'inAmount');
  const outputAmount = tokenAmount(response.outAmount, market.outputToken.decimals, 'outAmount');
  if (!inputAmount.greaterThan(0) || !outputAmount.greaterThan(0)) {
    throw new RangeError('Jupiter quote amounts must be positive');
  }
  const priceImpact = new Decimal(response.priceImpactPct);
  if (!priceImpact.isFinite() || priceImpact.isNegative()) throw new TypeError('Invalid priceImpactPct');

  const route = response.routePlan.map(({ swapInfo, percent, bps }) => ({
    ammKey: swapInfo.ammKey,
    dexLabel: swapInfo.label,
    inputMint: swapInfo.inputMint,
    outputMint: swapInfo.outputMint,
    inputAmountAtomic: swapInfo.inAmount,
    outputAmountAtomic: swapInfo.outAmount,
    ...(swapInfo.feeAmount === undefined ? {} : { feeAmountAtomic: swapInfo.feeAmount }),
    ...(swapInfo.feeMint === undefined ? {} : { feeMint: swapInfo.feeMint }),
    percent: new Decimal(percent ?? new Decimal(bps ?? 0).div(100)),
  }));

  return {
    notionalUsd,
    inputAmount,
    outputAmount,
    effectivePrice: inputAmount.div(outputAmount),
    priceImpact,
    route,
    dexLabels: [...new Set(route.map((step) => step.dexLabel))],
    quoteTimestamp,
    ...(response.contextSlot === undefined ? {} : { contextSlot: String(response.contextSlot) }),
  };
}
