import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL wajib tersedia untuk migrasi; tidak ada koneksi atau seed default.');
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const connection = await mysql.createConnection({ uri: url, multipleStatements: true, ssl: { rejectUnauthorized: true } });
try {
  await connection.query(schema);
  await connection.query('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', ['0001-paper-trading-core']);
  console.log('database migration applied: 0001-paper-trading-core');
} finally {
  await connection.end();
}
