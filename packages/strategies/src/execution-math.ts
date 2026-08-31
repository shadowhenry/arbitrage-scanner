import { Decimal, type OrderBookLevel } from '@arbitrage-scanner/core';

export interface BaseQuantityVwap {
  readonly baseQuantity: Decimal;
  readonly quoteNotional: Decimal;
  readonly vwap: Decimal;
}

export function quoteBudgetBaseQuantity(
  levels: readonly OrderBookLevel[],
  quoteBudget: Decimal,
): Decimal {
  let remaining = quoteBudget;
  let base = new Decimal(0);
  for (const level of levels) {
    if (remaining.isZero()) break;
    const availableQuote = level.price.mul(level.quantity);
    const usedQuote = Decimal.min(remaining, availableQuote);
    base = base.plus(usedQuote.div(level.price));
    remaining = remaining.minus(usedQuote);
  }
  return base;
}

export function vwapForBaseQuantity(
  levels: readonly OrderBookLevel[],
  requestedBase: Decimal,
): BaseQuantityVwap | undefined {
  let remaining = requestedBase;
  let quote = new Decimal(0);
  for (const level of levels) {
    if (remaining.isZero()) break;
    const usedBase = Decimal.min(remaining, level.quantity);
    quote = quote.plus(usedBase.mul(level.price));
    remaining = remaining.minus(usedBase);
  }
  if (!remaining.isZero() || requestedBase.isZero()) return undefined;
  return { baseQuantity: requestedBase, quoteNotional: quote, vwap: quote.div(requestedBase) };
}

