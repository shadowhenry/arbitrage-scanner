import { fileURLToPath } from 'node:url';
import { createDatabasePool } from './index.js';
import { runMigrations } from './migrate.js';

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') throw new Error('DATABASE_URL is required');

const pool = createDatabasePool({ connectionString: databaseUrl });
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

try {
  const results = await runMigrations(pool, migrationsDirectory);
  for (const migration of results) {
    process.stdout.write(`${migration.applied ? 'applied' : 'verified'} ${migration.filename}\n`);
  }
} finally {
  await pool.end();
}
