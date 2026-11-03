import { NextResponse } from 'next/server';
import { ForwardTestRepository } from '@/lib/forward-test/repository';
import { acquireApiRequest } from '@/lib/server/rate-limit';
import { redactOperationalError } from '@/lib/server/public-status';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let guard;
  try { guard = await acquireApiRequest(request, '/api/forward-test/status', { limit: 60, windowMs: 60_000, concurrency: 4, leaseMs: 15_000 }); }
  catch { return NextResponse.json({ ok: false, error: 'Rate limiter belum tersedia.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  if (!guard.allowed) return NextResponse.json({ ok: false, error: 'Batas request terlampaui.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(guard.retryAfterSeconds) } });
  try {
    const status = await new ForwardTestRepository().getStatus();
    return NextResponse.json({ ok: true, forwardTest: status ? redactOperationalError(status) : { status: 'not_started', qualified: false, activationAllowed: false } }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, error: 'Status forward-test belum tersedia.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  } finally { await guard.release().catch(() => undefined); }
}
