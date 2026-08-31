import { healthy } from '@arbitrage-scanner/core';

export function scannerHealth() {
  return healthy('scanner');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(scannerHealth()));
}

