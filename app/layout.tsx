import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { SITE_ORIGIN } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  alternates: { canonical: '/', languages: { 'id-ID': '/' } },
  title: { default: 'indo signal — Data live Indodax yang transparan', template: '%s | indo signal' },
  description: 'Pantau pasar Indodax dari data live resmi, dengan paper trading yang transparan dan tanpa janji profit.',
  applicationName: 'indo signal',
  keywords: ['Indodax', 'paper trading', 'pasar kripto Indonesia', 'analisis risiko'],
  authors: [{ name: 'indo signal' }],
  creator: 'indo signal',
  openGraph: { type: 'website', url: SITE_ORIGIN, siteName: 'indo signal', title: 'indo signal — Data live Indodax yang transparan', description: 'Data live resmi, paper trading transparan, dan risiko yang terlihat.', images: [{ url: '/logo.svg', width: 512, height: 512, alt: 'indo signal' }] },
  twitter: { card: 'summary' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: '#090b10', colorScheme: 'dark', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  const jsonLd = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: 'indo signal', url: SITE_ORIGIN, inLanguage: 'id-ID' }, { '@type': 'Organization', name: 'indo signal', url: SITE_ORIGIN }] };
  return <html lang="id"><body><AppShell>{children}</AppShell><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /><link rel="manifest" href="/manifest.webmanifest" /><script src="/sw.js" defer /></body></html>;
}
