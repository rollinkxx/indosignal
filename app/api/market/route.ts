import { NextResponse } from 'next/server';
import { getMarketOverview } from '@/lib/indodax/client';
import { acquireApiRequest } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let guard;
  try { guard = await acquireApiRequest(request, '/api/market', { limit: 90, windowMs: 60_000, concurrency: 8, leaseMs: 30_000 }); }
  catch { return NextResponse.json({ status: 'unavailable', error: 'Rate limiter belum tersedia.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  if (!guard.allowed) return NextResponse.json({ status: 'rate_limited', error: 'Terlalu banyak request; coba lagi sebentar.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(guard.retryAfterSeconds) } });
  try {
    const data = await getMarketOverview();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'error', error: 'Data pasar belum tersedia.', updatedAtMs: null }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  } finally {
    await guard.release().catch(() => undefined);
  }
}
