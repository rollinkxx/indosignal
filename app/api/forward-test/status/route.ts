import { NextResponse } from 'next/server';
import { ForwardTestRepository } from '@/lib/forward-test/repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await new ForwardTestRepository().getStatus();
    return NextResponse.json(
      { ok: true, forwardTest: status ?? { status: 'not_started', qualified: false, activationAllowed: false } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Status forward-test belum tersedia; lihat kesehatan database/worker.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
