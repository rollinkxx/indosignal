import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db/client';

export async function GET() {
  try {
    await getDbPool().query('SELECT 1');
    return NextResponse.json({ ok: true, service: 'indo-signal', database: 'ready' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, service: 'indo-signal', database: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
