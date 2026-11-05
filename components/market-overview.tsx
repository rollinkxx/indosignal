'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MarketSnapshot } from '@/lib/indodax/normalize';
import { formatCompactIdr, formatIdr } from '@/lib/format';

export function MarketOverview({ markets }: { markets: MarketSnapshot[] }) {
  const [currentMarkets, setCurrentMarkets] = useState(markets);
  const [lastUpdatedAtMs, setLastUpdatedAtMs] = useState<number | undefined>(undefined);
  const [refreshError, setRefreshError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;

    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/market', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('market refresh failed');
        const payload = await response.json() as { markets?: MarketSnapshot[]; updatedAtMs?: number };
        if (disposed || !Array.isArray(payload.markets)) throw new Error('market response invalid');
        setCurrentMarkets(payload.markets);
        setLastUpdatedAtMs(payload.updatedAtMs);
        setRefreshError(false);
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) setRefreshError(true);
      }
    };

    const interval = window.setInterval(() => { void refresh(); }, 20_000);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const displayMarkets: MarketSnapshot[] = refreshError
    ? currentMarkets.map((market) => ({ ...market, status: market.status === 'live' ? 'stale' : market.status }))
    : currentMarkets;

  return <section className="market-list" aria-labelledby="market-heading">
    <div className="section-heading"><div><p className="eyebrow">UNIVERSE DINAMIS</p><h2 id="market-heading">Top pasar IDR berdasarkan volume</h2>{refreshError ? <p className="muted" role="status">Pembaruan gagal; menampilkan data lama{lastUpdatedAtMs ? ` dari ${new Date(lastUpdatedAtMs).toLocaleTimeString('id-ID')}` : ''}.</p> : null}</div><span className="count">{displayMarkets.length} pasar teramati</span></div>
    <div className="market-rows">{displayMarkets.slice(0, 10).map((market, index) => <Link className="market-row" href={`/pasar/${encodeURIComponent(market.tickerId)}`} key={market.tickerId}>
      <span className="rank">{String(index + 1).padStart(2, '0')}</span><span className="pair-name"><strong>{market.symbol.replace('IDR', '')}</strong><small>{market.tickerId}</small></span>
      <span className="market-price"><strong>{formatIdr(market.last, market.pricePrecision)}</strong><small>bid {formatIdr(market.buy, market.pricePrecision)} · ask {formatIdr(market.sell, market.pricePrecision)}</small></span>
      <span className="market-volume"><strong>{formatCompactIdr(market.volumeIdr24h)}</strong><small>volume 24 jam</small></span>
      <span className={`row-state ${market.status}`}>{market.status === 'live' ? 'live' : 'stale'}</span>
    </Link>)}</div>
  </section>;
}
