import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const BASE = 'https://indodax.com';
const TIMEOUT_MS = 12_000;
const timeframes = [{ label: '15m', tf: '15', seconds: 900 }, { label: '1h', tf: '60', seconds: 3_600 }, { label: '4h', tf: '240', seconds: 14_400 }, { label: '1D', tf: '1D', seconds: 86_400 }];

function diagnosticToken(): string | null {
  const secret = process.env.DATABASE_URL;
  return secret ? createHash('sha256').update(secret).digest('hex') : null;
}

export async function GET(request: Request) {
  const expected = diagnosticToken();
  const supplied = request.headers.get('x-admin-diagnostic-token');
  if (!expected || supplied !== expected) return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const now = Math.floor(Date.now() / 1000);
  const results = await Promise.all(timeframes.map(async (timeframe) => {
    const from = now - timeframe.seconds * 200;
    const url = `${BASE}/tradingview/history_v2?symbol=BTCIDR&tf=${encodeURIComponent(timeframe.tf)}&from=${from}&to=${now}`;
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', 'Accept-Language': 'id-ID,id;q=0.9', Referer: 'https://indodax.com/', 'User-Agent': 'indo-signal/0.1 production-history-diagnostic' } });
      const body = (await response.text()).slice(0, 300);
      return { timeframe: timeframe.label, url, status: response.status, server: response.headers.get('server'), cfRay: response.headers.get('cf-ray'), contentType: response.headers.get('content-type'), bodyPrefix: body };
    } catch (error) {
      return { timeframe: timeframe.label, url, status: null, server: null, cfRay: null, contentType: null, bodyPrefix: error instanceof Error ? error.message : 'request failed' };
    }
  }));
  return NextResponse.json({ symbol: 'BTCIDR', checkedAt: new Date().toISOString(), results }, { headers: { 'Cache-Control': 'no-store' } });
}
