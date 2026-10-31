import mysql, { type Pool } from 'mysql2/promise';

let pool: Pool | undefined;

export function getDbPool(): Pool {
  if (pool) return pool;
  const dsn = process.env.DATABASE_URL;
  if (!dsn) throw new Error('DATABASE_URL belum tersedia.');
  const parsed = new URL(dsn);
  pool = mysql.createPool({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
    timezone: 'Z',
    ssl: { rejectUnauthorized: true },
  });
  return pool;
}
