import { healthy } from '@arbitrage-scanner/core';

export function collectorHealth() {
  return healthy('collector');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(collectorHealth()));
}

