import { NextResponse } from 'next/server';
import { getMarketOverview } from '@/lib/indodax/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getMarketOverview();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ status: 'error', error: error instanceof Error ? error.message : 'market unavailable', updatedAtMs: null }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
