import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL wajib tersedia untuk migrasi; tidak ada koneksi atau seed default.');

const client = new Client({ connectionString, ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 10_000 });
const migrationLock = 'SELECT pg_advisory_xact_lock(141414, 1004)';

await client.connect();
try {
  const initialSchema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await client.query('BEGIN');
  await client.query(migrationLock);
  await client.query(initialSchema);
  await client.query(
    'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
    ['0003-postgresql-initial'],
  );
  await client.query('COMMIT');
  console.log('database migration applied: 0003-postgresql-initial');

  const directory = new URL('./migrations/', import.meta.url);
  const migrationFiles = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(name))
    .sort();

  for (const filename of migrationFiles) {
    const version = filename.replace(/\.sql$/, '').replace('_', '-');
    await client.query('BEGIN');
    await client.query(migrationLock);
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
    if (applied.rowCount) {
      await client.query('COMMIT');
      console.log(`database migration already applied: ${version}`);
      continue;
    }

    const sql = await readFile(new URL(`./migrations/${filename}`, import.meta.url), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    await client.query('COMMIT');
    console.log(`database migration applied: ${version}`);
  }
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
  throw error;
} finally {
  await client.end();
}
