import { readFile } from 'node:fs/promises';
import pg from 'pg';
const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL wajib tersedia untuk migrasi; tidak ada koneksi atau seed default.');
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(schema);
  await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', ['0003-postgresql-initial']);
  await client.query('COMMIT');
  console.log('database migration applied: 0003-postgresql-initial');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
