import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

export interface AppliedMigration {
  readonly filename: string;
  readonly checksum: string;
  readonly applied: boolean;
}

export async function runMigrations(
  pool: Pool,
  migrationsDirectory: string,
): Promise<readonly AppliedMigration[]> {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+.*\.sql$/.test(filename) && !filename.endsWith('.down.sql'))
    .sort();
  const client = await pool.connect();
  const results: AppliedMigration[] = [];
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('arbitrage-scanner:migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations',
    );
    const known = new Map(applied.rows.map((row) => [row.filename, row.checksum]));

    for (const filename of filenames) {
      const sql = await readFile(join(migrationsDirectory, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previousChecksum = known.get(filename);
      if (previousChecksum !== undefined && previousChecksum !== checksum) {
        throw new Error(`Applied migration was modified: ${filename}`);
      }
      if (previousChecksum === undefined) {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum],
        );
      }
      results.push({ filename, checksum, applied: previousChecksum === undefined });
    }
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
