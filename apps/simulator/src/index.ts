import { healthy } from '@arbitrage-scanner/core';
import { EXECUTION_MODE } from '@arbitrage-scanner/execution';

export { ReplayEngine } from './replay-engine.js';
export * from './replay-types.js';
export { HistoricalDataLoader, generateSyntheticEvents } from './data-loader.js';
export type { DataLoaderConfig, DataLoadSummary } from './data-loader.js';
export {
  evaluateGoNoGo,
  generateHtmlReport,
  generateMarkdownReport,
  DEFAULT_GO_NO_GO_THRESHOLDS,
} from './report-generator.js';
export type { GoNoGoThresholds, GoNoGoResult } from './report-generator.js';

export function simulatorHealth() {
  return { ...healthy('simulator'), executionMode: EXECUTION_MODE };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(simulatorHealth()));
}
