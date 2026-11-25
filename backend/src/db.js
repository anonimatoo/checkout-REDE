import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';

export function openPool(connectionString) {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 4_000,
    statement_timeout: 8_000,
  });
}

export async function inTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(pool) {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  await inTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(97825574)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY)');
    const applied = await client.query('SELECT filename FROM schema_migrations');
    const seen = new Set(applied.rows.map(row => row.filename));
    for (const file of files) {
      if (seen.has(file)) continue;
      await client.query(await readFile(new URL(file, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
    }
  });
}

export async function audit(db, adminId, action, subject = '') {
  await db.query(
    'INSERT INTO audit_events (admin_id, action, subject) VALUES ($1, $2, $3)',
    [adminId, action, subject],
  );
}
