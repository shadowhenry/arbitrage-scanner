import { Pool, type PoolConfig } from 'pg';

export function createDatabasePool(config: PoolConfig): Pool {
  return new Pool(config);
}

export * from './migrate.js';
