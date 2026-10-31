import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ ok: true, service: 'indo-signal' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
