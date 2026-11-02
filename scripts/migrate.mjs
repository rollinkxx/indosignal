import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { backfillAuditChain } from './audit-chain-backfill.mjs';

const { Client } = pg;
const isProduction = process.env.NODE_ENV === 'production';
const allowRuntimeFallback = process.env.ALLOW_RUNTIME_DATABASE_MIGRATION === 'true';
const connectionString = process.env.MIGRATION_DATABASE_URL
  ?? (!isProduction && allowRuntimeFallback ? process.env.DATABASE_URL : undefined);
if (!connectionString) {
  throw new Error(isProduction
    ? 'MIGRATION_DATABASE_URL wajib tersedia di production; DATABASE_URL runtime tidak boleh digunakan sebagai migrator.'
    : 'MIGRATION_DATABASE_URL wajib tersedia; fallback DATABASE_URL hanya aktif jika ALLOW_RUNTIME_DATABASE_MIGRATION=true.');
}

const migrationSsl = process.env.MIGRATION_DATABASE_SSL ?? process.env.DATABASE_SSL;
const client = new Client({ connectionString, ssl: migrationSsl === 'disable' ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 10_000 });
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
  const auditMigration = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', ['0008-event_hash_chain']);
  if (auditMigration.rowCount) {
    const result = await backfillAuditChain(client);
    console.log(`forward-test audit hash chain verified/backfilled: ${result.backfilled} event(s)`);
  }
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
  throw error;
} finally {
  await client.end();
}
