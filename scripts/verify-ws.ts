// Verify the Dashboard WebSocket feed receives scanner-pushed rows in real time.
// Usage: API_URL=http://127.0.0.1:3100 npx tsx scripts/verify-ws.ts
import { toOpportunityRow } from '../apps/scanner/src/push.js';
import { Decimal } from '@arbitrage-scanner/core';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3000';
const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

async function main(): Promise<void> {
  const ws = new WebSocket(WS_URL);
  const received: string[] = [];
  const timer = setTimeout(() => {
    console.log('WS_TIMEOUT');
    process.exit(1);
  }, 8000);

  ws.onopen = () => {
    console.log('WS connected:', WS_URL);
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['dashboard'] }));
    // After subscribing, push an opportunity via REST and wait for the WS echo.
    setTimeout(async () => {
      const opp = {
        strategyId: 'S3', assetSymbol: 'ETH', buyVenueId: 'binance', sellVenueId: 'bybit',
        capitalBucketUsd: 5000, executableCapitalUsd: new Decimal('1000'),
        executableBaseQuantity: new Decimal('2'), buyCostUsd: new Decimal('980'),
        sellProceedsUsd: new Decimal('990'), grossTradeProfitUsd: new Decimal('10'),
        fundingProfitUsd: new Decimal('0'), entryFeesUsd: new Decimal('1'),
        exitFeesEstimateUsd: new Decimal('1'), returnOnCapital: new Decimal('0.01'),
      } as never;
      const row = toOpportunityRow(opp as never, 490, 495, new Date());
      const res = await fetch(`${API_URL}/api/opportunities`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row),
      });
      console.log('REST push status:', res.status);
    }, 500);
  };

  ws.onmessage = (event: MessageEvent) => {
    const msg = JSON.parse(String(event.data));
    if (msg.type === 'opportunity.upsert' && msg.data.id?.includes('opp-S3')) {
      received.push(msg.data.id);
      clearTimeout(timer);
      console.log('WS received opportunity.upsert:', msg.data.id, msg.data.asset, msg.data.strategy);
      console.log('VERIFY_WS_DONE');
      ws.close();
      process.exit(0);
    }
  };

  ws.onerror = (e) => {
    console.error('WS error:', String(e));
    clearTimeout(timer);
    process.exit(1);
  };
}

void main();
