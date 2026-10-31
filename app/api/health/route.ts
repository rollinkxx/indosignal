import { NextResponse } from 'next/server';
import { getMarketOverview } from '@/lib/indodax/client';

export async function GET() {
  try {
    const { markets, updatedAtMs } = await getMarketOverview();
    const fresh = markets.some((market) => market.status === 'live');
    return NextResponse.json({ ok: true, market: fresh ? 'live' : 'stale', updatedAtMs }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: true, market: 'error', error: error instanceof Error ? error.message : 'unavailable' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
