import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const dsn = process.env.DATABASE_URL;
if (!dsn) throw new Error('DATABASE_URL wajib tersedia untuk migrasi; tidak ada koneksi atau seed default.');
const parsed = new URL(dsn);
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const connection = await mysql.createConnection({
  host: parsed.hostname,
  port: Number(parsed.port || 3306),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  multipleStatements: true,
  timezone: 'Z',
  ssl: { rejectUnauthorized: true },
});
try {
  await connection.query(schema);
  await connection.query('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', ['0002-paper-positions-closed-trades']);
  console.log('database migration applied: 0002-paper-positions-closed-trades');
} finally {
  await connection.end();
}
