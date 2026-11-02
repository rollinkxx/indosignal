import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { acquireApiRequest } from '@/lib/server/rate-limit';
import { consumeProviderRequest } from '@/lib/indodax/rate-limit';

export const dynamic = 'force-dynamic';
const BASE = 'https://indodax.com';
const TIMEOUT_MS = 8_000;
const timeframes = [{ label: '15m', tf: '15', seconds: 900 }, { label: '1h', tf: '60', seconds: 3_600 }, { label: '4h', tf: '240', seconds: 14_400 }, { label: '1D', tf: '1D', seconds: 86_400 }];

function authorized(request: Request): boolean {
  const expected = process.env.ADMIN_DIAGNOSTIC_TOKEN;
  const supplied = request.headers.get('x-admin-diagnostic-token') ?? '';
  if (!expected || expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  let guard;
  try { guard = await acquireApiRequest(request, '/api/admin/history-diagnostic', { limit: 2, windowMs: 60_000, concurrency: 1, leaseMs: 30_000 }); }
  catch { return NextResponse.json({ error: 'diagnostic limiter unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  if (!guard.allowed) return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(guard.retryAfterSeconds) } });
  try {
    const now = Math.floor(Date.now() / 1000);
    const results = await Promise.all(timeframes.map(async (timeframe) => {
      const from = now - timeframe.seconds * 200;
      const path = `/tradingview/history_v2?symbol=BTCIDR&tf=${encodeURIComponent(timeframe.tf)}&from=${from}&to=${now}`;
      try {
        consumeProviderRequest();
        const response = await fetch(`${BASE}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', 'Accept-Language': 'id-ID,id;q=0.9', Referer: 'https://indodax.com/', 'User-Agent': 'indo-signal/0.1 production-history-diagnostic' } });
        const body = (await response.text()).slice(0, 300);
        return { timeframe: timeframe.label, status: response.status, server: response.headers.get('server'), cfRay: response.headers.get('cf-ray'), contentType: response.headers.get('content-type'), bodyPrefix: body };
      } catch (error) {
        return { timeframe: timeframe.label, status: null, server: null, cfRay: null, contentType: null, bodyPrefix: error instanceof Error && error.name === 'TimeoutError' ? 'upstream timeout' : 'upstream request failed' };
      }
    }));
    return NextResponse.json({ symbol: 'BTCIDR', checkedAt: new Date().toISOString(), results }, { headers: { 'Cache-Control': 'no-store' } });
  } finally {
    await guard.release().catch(() => undefined);
  }
}
