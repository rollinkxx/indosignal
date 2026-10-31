import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'indo signal — Data live Indodax yang transparan', template: '%s | indo signal' },
  description: 'Pantau pasar Indodax dari data live resmi, dengan paper trading yang transparan dan tanpa janji profit.',
  applicationName: 'indo signal',
  keywords: ['Indodax', 'paper trading', 'pasar kripto Indonesia', 'analisis risiko'],
  authors: [{ name: 'indo signal' }],
  creator: 'indo signal',
  openGraph: { type: 'website', siteName: 'indo signal', title: 'indo signal — Data live Indodax yang transparan', description: 'Data live resmi, paper trading transparan, dan risiko yang terlihat.' },
  twitter: { card: 'summary' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: '#090b10', colorScheme: 'dark', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="id"><body><AppShell>{children}</AppShell><script src="/sw.js" defer /></body></html>;
}
