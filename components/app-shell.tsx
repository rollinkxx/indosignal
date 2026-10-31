import Link from 'next/link';

export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="app-frame">
    <header className="topbar">
      <Link className="wordmark" href="/" aria-label="indo signal beranda"><span className="mark" />indo signal</Link>
      <span className="topbar-note">paper intelligence / IDR market</span>
    </header>
    <main>{children}</main>
    <nav className="bottom-nav" aria-label="Navigasi utama">
      <Link href="/">Ikhtisar</Link><Link href="/performa">Performa</Link><Link href="/strategi/trend-following">Strategi</Link>
    </nav>
    <footer className="risk-footer">Bukan nasihat keuangan. Paper trading tidak sama dengan hasil nyata. Tidak berafiliasi dengan Indodax.</footer>
  </div>;
}
