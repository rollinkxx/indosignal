import { Pool, type PoolClient } from 'pg';

let pool: Pool | undefined;

export function getDbPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL belum tersedia.');
  pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: true },
  });
  return pool;
}

export type { PoolClient };
