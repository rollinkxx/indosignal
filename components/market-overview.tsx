import Link from 'next/link';
import type { MarketSnapshot } from '@/lib/indodax/normalize';
import { formatCompactIdr, formatIdr } from '@/lib/format';

export function MarketOverview({ markets }: { markets: MarketSnapshot[] }) {
  return <section className="market-list" aria-labelledby="market-heading">
    <div className="section-heading"><div><p className="eyebrow">UNIVERSE DINAMIS</p><h2 id="market-heading">Top pasar IDR berdasarkan volume</h2></div><span className="count">{markets.length} pasar teramati</span></div>
    <div className="market-rows">{markets.slice(0, 10).map((market, index) => <Link className="market-row" href={`/pasar/${encodeURIComponent(market.tickerId)}`} key={market.tickerId}>
      <span className="rank">{String(index + 1).padStart(2, '0')}</span><span className="pair-name"><strong>{market.symbol.replace('IDR', '')}</strong><small>{market.tickerId}</small></span>
      <span className="market-price"><strong>{formatIdr(market.last)}</strong><small>bid {formatIdr(market.buy)} · ask {formatIdr(market.sell)}</small></span>
      <span className="market-volume"><strong>{formatCompactIdr(market.volumeIdr24h)}</strong><small>volume 24 jam</small></span>
      <span className={`row-state ${market.status}`}>{market.status === 'live' ? 'live' : 'stale'}</span>
    </Link>)}</div>
  </section>;
}
