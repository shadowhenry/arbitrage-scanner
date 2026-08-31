import {
  Decimal,
  EXECUTABLE_NOTIONALS_USD,
  calculateBuyVwap,
  calculateSellVwap,
  type Asset,
  type ExecutableNotionalUsd,
  type Opportunity,
  type OrderBook,
  type OrderSide,
  type RoutingExecutablePriceCurve,
  type Venue,
} from '@arbitrage-scanner/core';
import { vwapForBaseQuantity } from './execution-math.js';

export type GraphStrategyId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
export type GraphMarketType = 'spot' | 'perpetual';

interface GraphNodeBase {
  readonly id: string;
  readonly venue: Venue;
  readonly marketType: GraphMarketType;
  readonly baseAsset: Asset;
  readonly quoteAsset: Asset;
  readonly takerFeeRate: Decimal.Value;
  readonly observedAt: Date;
  readonly hourlyFundingRate?: Decimal.Value;
  readonly fundingObservedAt?: Date;
}

export interface OrderBookGraphNode extends GraphNodeBase {
  readonly executionKind: 'orderbook';
  readonly orderBook: OrderBook;
}

export interface RoutingGraphNode extends GraphNodeBase {
  readonly executionKind: 'routing';
  readonly buyCurve?: RoutingExecutablePriceCurve;
  readonly sellCurve?: RoutingExecutablePriceCurve;
}

export type ArbitrageGraphNode = OrderBookGraphNode | RoutingGraphNode;

export interface ExecutableTradeEdge {
  readonly id: string;
  readonly nodeId: string;
  readonly assetSymbol: string;
  readonly side: OrderSide;
  readonly capitalBucketUsd: ExecutableNotionalUsd;
  readonly baseQuantity: Decimal;
  readonly quoteAmountUsd: Decimal;
  readonly effectivePrice: Decimal;
  readonly feeUsd: Decimal;
  /** Routing quotes are exact and may not be resized safely. */
  readonly fixedQuantity: boolean;
  readonly observedAt: Date;
}

export interface ArbitrageGraph {
  readonly nodes: readonly ArbitrageGraphNode[];
  readonly edges: readonly ExecutableTradeEdge[];
}

export interface GraphEngineConfig {
  readonly fundingHorizonHours?: Decimal.Value;
  readonly maxDataAgeMs?: number;
  readonly now?: Date;
  readonly requirePositiveProfit?: boolean;
  readonly includeDerivativeExitFees?: boolean;
}

export interface GraphArbitrageOpportunity extends Opportunity {
  readonly strategyId: GraphStrategyId;
  readonly assetSymbol: string;
  readonly capitalBucketUsd: ExecutableNotionalUsd;
  readonly buyNodeId: string;
  readonly sellNodeId: string;
  readonly buyVenueId: string;
  readonly sellVenueId: string;
  readonly executableBaseQuantity: Decimal;
  readonly executableCapitalUsd: Decimal;
  readonly buyCostUsd: Decimal;
  readonly sellProceedsUsd: Decimal;
  readonly grossTradeProfitUsd: Decimal;
  readonly fundingProfitUsd: Decimal;
  readonly entryFeesUsd: Decimal;
  readonly exitFeesEstimateUsd: Decimal;
  readonly returnOnCapital: Decimal;
}

function decimalRate(value: Decimal.Value, name: string): Decimal {
  const rate = new Decimal(value);
  if (!rate.isFinite() || rate.isNegative()) throw new RangeError(`${name} must be non-negative`);
  return rate;
}

function normalizedAsset(node: ArbitrageGraphNode): string {
  return node.baseAsset.symbol.trim().toUpperCase();
}

function isUsdAsset(asset: Asset): boolean {
  return ['USD', 'USDC', 'USDT'].includes(asset.symbol.trim().toUpperCase());
}

function routingPoint(
  node: RoutingGraphNode,
  side: OrderSide,
  bucket: ExecutableNotionalUsd,
): ExecutableTradeEdge | undefined {
  const curve = side === 'buy' ? node.buyCurve : node.sellCurve;
  const point = curve?.quotes.find((quote) => quote.notionalUsd === bucket);
  if (curve === undefined || point === undefined) return undefined;
  const validOrientation = side === 'buy'
    ? isUsdAsset(curve.inputAsset) && curve.outputAsset.symbol.toUpperCase() === normalizedAsset(node)
    : curve.inputAsset.symbol.toUpperCase() === normalizedAsset(node) && isUsdAsset(curve.outputAsset);
  if (!validOrientation) return undefined;
  const baseQuantity = side === 'buy' ? point.outputAmount : point.inputAmount;
  const quoteAmountUsd = side === 'buy' ? point.inputAmount : point.outputAmount;
  if (!baseQuantity.greaterThan(0) || !quoteAmountUsd.greaterThan(0)) return undefined;
  const feeUsd = quoteAmountUsd.mul(decimalRate(node.takerFeeRate, 'takerFeeRate'));
  return {
    id: `${node.id}:${side}:${bucket}`,
    nodeId: node.id,
    assetSymbol: normalizedAsset(node),
    side,
    capitalBucketUsd: bucket,
    baseQuantity,
    quoteAmountUsd,
    effectivePrice: quoteAmountUsd.div(baseQuantity),
    feeUsd,
    fixedQuantity: true,
    observedAt: point.quoteTimestamp,
  };
}

function orderBookPoint(
  node: OrderBookGraphNode,
  side: OrderSide,
  bucket: ExecutableNotionalUsd,
): ExecutableTradeEdge | undefined {
  const result = side === 'buy'
    ? calculateBuyVwap(node.orderBook.asks, bucket)
    : calculateSellVwap(node.orderBook.bids, bucket);
  if (!result.fullyExecutable || result.vwap === null) return undefined;
  return {
    id: `${node.id}:${side}:${bucket}`,
    nodeId: node.id,
    assetSymbol: normalizedAsset(node),
    side,
    capitalBucketUsd: bucket,
    baseQuantity: result.baseQuantity,
    quoteAmountUsd: result.filledQuote,
    effectivePrice: result.vwap,
    feeUsd: result.filledQuote.mul(decimalRate(node.takerFeeRate, 'takerFeeRate')),
    fixedQuantity: false,
    observedAt: node.orderBook.observedAt,
  };
}

function edgeFor(node: ArbitrageGraphNode, side: OrderSide, bucket: ExecutableNotionalUsd): ExecutableTradeEdge | undefined {
  return node.executionKind === 'orderbook'
    ? orderBookPoint(node, side, bucket)
    : routingPoint(node, side, bucket);
}

export function buildArbitrageGraph(nodes: readonly ArbitrageGraphNode[]): ArbitrageGraph {
  const ids = new Set<string>();
  const edges: ExecutableTradeEdge[] = [];
  for (const node of nodes) {
    if (node.venue.kind === 'prediction' || node.marketType === ('prediction' as GraphMarketType)) {
      throw new TypeError('Prediction markets, including Polymarket, are not valid arbitrage graph nodes');
    }
    if (ids.has(node.id)) throw new TypeError(`Duplicate graph node: ${node.id}`);
    ids.add(node.id);
    if (!isUsdAsset(node.quoteAsset)) continue;
    for (const bucket of EXECUTABLE_NOTIONALS_USD) {
      const buy = edgeFor(node, 'buy', bucket);
      const sell = edgeFor(node, 'sell', bucket);
      if (buy !== undefined) edges.push(buy);
      if (sell !== undefined) edges.push(sell);
    }
  }
  return { nodes: [...nodes], edges };
}

function strategyFor(buy: ArbitrageGraphNode, sell: ArbitrageGraphNode): GraphStrategyId | undefined {
  if (buy.marketType === 'perpetual' && sell.marketType === 'perpetual') return 'S2';
  if (buy.marketType !== sell.marketType) return 'S1';
  if (buy.marketType !== 'spot') return undefined;
  if (buy.venue.kind === 'cex' && sell.venue.kind === 'cex') return 'S3';
  if (buy.venue.kind !== sell.venue.kind) return 'S4';
  if (buy.venue.kind === 'dex' && sell.venue.kind === 'dex') return 'S5';
  return undefined;
}

function resizeOrderBookEdge(
  node: OrderBookGraphNode,
  edge: ExecutableTradeEdge,
  baseQuantity: Decimal,
): ExecutableTradeEdge | undefined {
  const levels = edge.side === 'buy' ? node.orderBook.asks : node.orderBook.bids;
  const fill = vwapForBaseQuantity(levels, baseQuantity);
  if (fill === undefined) return undefined;
  return {
    ...edge,
    baseQuantity,
    quoteAmountUsd: fill.quoteNotional,
    effectivePrice: fill.vwap,
    feeUsd: fill.quoteNotional.mul(decimalRate(node.takerFeeRate, 'takerFeeRate')),
  };
}

function matchedEdges(
  buyNode: ArbitrageGraphNode,
  sellNode: ArbitrageGraphNode,
  buy: ExecutableTradeEdge,
  sell: ExecutableTradeEdge,
): readonly [ExecutableTradeEdge, ExecutableTradeEdge] | undefined {
  if (buy.fixedQuantity && sell.fixedQuantity) {
    return buy.baseQuantity.equals(sell.baseQuantity) ? [buy, sell] : undefined;
  }
  const quantity = buy.fixedQuantity ? buy.baseQuantity
    : sell.fixedQuantity ? sell.baseQuantity
      : Decimal.min(buy.baseQuantity, sell.baseQuantity);
  const matchedBuy = buy.fixedQuantity ? buy
    : resizeOrderBookEdge(buyNode as OrderBookGraphNode, buy, quantity);
  const matchedSell = sell.fixedQuantity ? sell
    : resizeOrderBookEdge(sellNode as OrderBookGraphNode, sell, quantity);
  return matchedBuy === undefined || matchedSell === undefined ? undefined : [matchedBuy, matchedSell];
}

function fundingRate(node: ArbitrageGraphNode): Decimal {
  return node.marketType === 'perpetual' ? new Decimal(node.hourlyFundingRate ?? 0) : new Decimal(0);
}

function isFresh(node: ArbitrageGraphNode, edge: ExecutableTradeEdge, now: Date, maxAgeMs: number): boolean {
  const timestamps = [node.observedAt.getTime(), edge.observedAt.getTime()];
  if (node.marketType === 'perpetual') timestamps.push(node.fundingObservedAt?.getTime() ?? 0);
  return now.getTime() - Math.min(...timestamps) <= maxAgeMs;
}

export function scanArbitrageGraph(
  nodes: readonly ArbitrageGraphNode[],
  config: GraphEngineConfig = {},
): readonly GraphArbitrageOpportunity[] {
  const graph = buildArbitrageGraph(nodes);
  const now = config.now ?? new Date();
  const maxAgeMs = config.maxDataAgeMs ?? 10_000;
  const horizon = new Decimal(config.fundingHorizonHours ?? 8);
  if (!horizon.isFinite() || horizon.isNegative()) throw new RangeError('fundingHorizonHours must be non-negative');
  const edgesByKey = new Map(graph.edges.map((edge) => [`${edge.nodeId}:${edge.side}:${edge.capitalBucketUsd}`, edge]));
  const opportunities: GraphArbitrageOpportunity[] = [];

  for (const buyNode of graph.nodes) {
    for (const sellNode of graph.nodes) {
      if (buyNode.id === sellNode.id || normalizedAsset(buyNode) !== normalizedAsset(sellNode)) continue;
      const strategyId = strategyFor(buyNode, sellNode);
      if (strategyId === undefined) continue;
      for (const bucket of EXECUTABLE_NOTIONALS_USD) {
        const buy = edgesByKey.get(`${buyNode.id}:buy:${bucket}`);
        const sell = edgesByKey.get(`${sellNode.id}:sell:${bucket}`);
        if (buy === undefined || sell === undefined
          || !isFresh(buyNode, buy, now, maxAgeMs) || !isFresh(sellNode, sell, now, maxAgeMs)) continue;
        const matched = matchedEdges(buyNode, sellNode, buy, sell);
        if (matched === undefined) continue;
        const [matchedBuy, matchedSell] = matched;
        const grossTradeProfitUsd = matchedSell.quoteAmountUsd.minus(matchedBuy.quoteAmountUsd);
        const fundingProfitUsd = matchedSell.quoteAmountUsd.mul(fundingRate(sellNode))
          .minus(matchedBuy.quoteAmountUsd.mul(fundingRate(buyNode))).mul(horizon);
        const entryFeesUsd = matchedBuy.feeUsd.plus(matchedSell.feeUsd);
        const hasDerivative = buyNode.marketType === 'perpetual' || sellNode.marketType === 'perpetual';
        const exitFeesEstimateUsd = hasDerivative && (config.includeDerivativeExitFees ?? true)
          ? entryFeesUsd
          : new Decimal(0);
        const expectedProfitUsd = grossTradeProfitUsd.plus(fundingProfitUsd)
          .minus(entryFeesUsd).minus(exitFeesEstimateUsd);
        if ((config.requirePositiveProfit ?? true) && !expectedProfitUsd.greaterThan(0)) continue;
        const executableCapitalUsd = matchedBuy.quoteAmountUsd.plus(matchedBuy.feeUsd);
        const returnOnCapital = expectedProfitUsd.div(executableCapitalUsd);
        const observedAt = new Date(Math.min(matchedBuy.observedAt.getTime(), matchedSell.observedAt.getTime()));
        opportunities.push({
          id: `${strategyId}:${normalizedAsset(buyNode)}:${buyNode.id}:buy:${sellNode.id}:sell:${bucket}`,
          strategyId,
          assetSymbol: normalizedAsset(buyNode),
          capitalBucketUsd: bucket,
          buyNodeId: buyNode.id,
          sellNodeId: sellNode.id,
          buyVenueId: buyNode.venue.id,
          sellVenueId: sellNode.venue.id,
          executableBaseQuantity: matchedBuy.baseQuantity,
          executableCapitalUsd,
          buyCostUsd: matchedBuy.quoteAmountUsd,
          sellProceedsUsd: matchedSell.quoteAmountUsd,
          grossTradeProfitUsd,
          fundingProfitUsd,
          entryFeesUsd,
          exitFeesEstimateUsd,
          returnOnCapital,
          notionalUsd: executableCapitalUsd,
          expectedProfitUsd,
          expectedEdgeBps: returnOnCapital.mul(10_000),
          legs: [
            { side: 'buy', marketId: buyNode.id, price: matchedBuy.effectivePrice, baseQuantity: matchedBuy.baseQuantity },
            { side: 'sell', marketId: sellNode.id, price: matchedSell.effectivePrice, baseQuantity: matchedSell.baseQuantity },
          ],
          observedAt,
        });
      }
    }
  }
  return opportunities.sort((left, right) => {
    const profitOrder = right.expectedProfitUsd.comparedTo(left.expectedProfitUsd);
    return profitOrder !== 0 ? profitOrder : right.returnOnCapital.comparedTo(left.returnOnCapital);
  });
}

/** Useful when callers need to resolve an edge back to its node without exposing internal maps. */
export function graphNodeForEdge(graph: ArbitrageGraph, edge: ExecutableTradeEdge): ArbitrageGraphNode | undefined {
  return graph.nodes.find((node) => node.id === edge.nodeId);
}
