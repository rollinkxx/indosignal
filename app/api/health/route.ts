import { NextResponse } from 'next/server';
import { getMarketOverview } from '@/lib/indodax/client';
import { runtimeTelemetry } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { markets, updatedAtMs } = await getMarketOverview();
    const fresh = markets.some((market) => market.status === 'live');
    return NextResponse.json({ ok: fresh, market: fresh ? 'live' : 'stale', updatedAtMs, telemetry: runtimeTelemetry() }, { status: fresh ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, market: 'unavailable', error: 'Dependency pasar tidak tersedia.', telemetry: runtimeTelemetry() }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
