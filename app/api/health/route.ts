import { NextResponse } from 'next/server';
import { getMarketOverview } from '@/lib/indodax/client';

export async function GET() {
  try {
    const { markets, updatedAtMs } = await getMarketOverview();
    const fresh = markets.some((market) => market.status === 'live');
    return NextResponse.json({ ok: true, market: fresh ? 'live' : 'stale', updatedAtMs }, { status: fresh ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, market: 'error', error: error instanceof Error ? error.message : 'unavailable' }, { status: 503 });
  }
}
