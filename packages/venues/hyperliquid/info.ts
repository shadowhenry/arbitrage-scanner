import type {
  HyperliquidFundingHistoryRecord,
  HyperliquidPerpMetaAndContexts,
  HyperliquidSpotMetaAndContexts,
} from './types.js';

const INFO_URL = 'https://api.hyperliquid.xyz/info';

export async function requestHyperliquidInfo<T>(payload: object): Promise<T> {
  const response = await fetch(INFO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Hyperliquid info request failed: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function fetchHyperliquidPerpMetadata(): Promise<HyperliquidPerpMetaAndContexts> {
  return requestHyperliquidInfo({ type: 'metaAndAssetCtxs' });
}

export function fetchHyperliquidSpotMetadata(): Promise<HyperliquidSpotMetaAndContexts> {
  return requestHyperliquidInfo({ type: 'spotMetaAndAssetCtxs' });
}

export async function fetchHyperliquidFundingHistory(
  coin: string,
  startTime: number,
  endTime = Date.now(),
  request: <T>(payload: object) => Promise<T> = requestHyperliquidInfo,
): Promise<readonly HyperliquidFundingHistoryRecord[]> {
  const records: HyperliquidFundingHistoryRecord[] = [];
  let cursor = startTime;

  while (cursor <= endTime) {
    const page = await request<HyperliquidFundingHistoryRecord[]>({
      type: 'fundingHistory', coin, startTime: cursor, endTime,
    });
    if (page.length === 0) break;
    records.push(...page);
    const lastTime = page.at(-1)?.time;
    if (lastTime === undefined || lastTime < cursor || page.length < 500) break;
    cursor = lastTime + 1;
  }
  return records;
}

