export const EXECUTION_MODE = 'read-only' as const;

export function assertTradingDisabled(): never {
  throw new Error('Real-money execution is disabled in Phase 1');
}

