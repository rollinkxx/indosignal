import { NextResponse } from 'next/server';
import { getMarketOverview } from '@/lib/indodax/client';
import { consumeClientRequest } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const clientKey = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anonymous';
  if (!consumeClientRequest(clientKey)) return NextResponse.json({ status: 'rate_limited', error: 'Terlalu banyak request; coba lagi sebentar.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  try {
    const data = await getMarketOverview();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ status: 'error', error: error instanceof Error ? error.message : 'market unavailable', updatedAtMs: null }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
