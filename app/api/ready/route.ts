import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db/client';

const REQUIRED_MIGRATIONS = ['0003-postgresql-initial', '0004-forward-test', '0005-multi-pair-scan', '0006-retire_legacy_btc_forward_test', '0007-api_limits', '0008-event_hash_chain', '0009-database_constraints'];

export async function GET() {
  try {
    const pool = getDbPool();
    const role = await pool.query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname=current_user');
    if (role.rows[0]?.rolsuper) return NextResponse.json({ ok: false, service: 'indo-signal', database: 'unsafe-role' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const migrations = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(migrations.rows.map((row) => row.version));
    const missing = REQUIRED_MIGRATIONS.filter((version) => !applied.has(version));
    if (missing.length) return NextResponse.json({ ok: false, service: 'indo-signal', database: 'migrations-pending', missing }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ ok: true, service: 'indo-signal', database: 'ready', migrations: 'ready' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, service: 'indo-signal', database: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
