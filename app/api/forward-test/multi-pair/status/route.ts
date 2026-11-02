import { NextResponse } from 'next/server';
import { MultiPairScanRepository } from '@/lib/forward-test/multi-pair-repository';
import { startMultiPairScanner } from '@/lib/forward-test/multi-pair-worker';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // The scanner is observation-only; this also recovers deployments where
    // the process started without running the instrumentation hook.
    startMultiPairScanner();
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
