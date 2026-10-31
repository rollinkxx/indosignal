import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ name: 'indo signal', short_name: 'indo signal', description: 'Data live Indodax dan paper trading transparan.', start_url: '/', display: 'standalone', background_color: '#090b10', theme_color: '#090b10', lang: 'id-ID', icons: [{ src: '/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, { headers: { 'Content-Type': 'application/manifest+json' } });
}
