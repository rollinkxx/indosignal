import { NextResponse } from 'next/server';
import { MultiPairScanRepository } from '@/lib/forward-test/multi-pair-repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await new MultiPairScanRepository().getStatus();
    return NextResponse.json(
      { ok: true, multiPairScan: status ?? { status: 'not_started', scanOnly: true, paperOrdersCreated: false } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Status scanner multi-pair belum tersedia; periksa migrasi database dan worker.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
