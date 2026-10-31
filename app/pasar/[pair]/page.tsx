import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MarketStatus } from '@/components/market-status';
import { Orderbook } from '@/components/orderbook';
import { getMarketDetail } from '@/lib/indodax/client';
import { formatIdr, formatTime } from '@/lib/format';
import { toEpochMs } from '@/lib/indodax/normalize';
import { SITE_ORIGIN } from '@/lib/site';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ pair: string }> }): Promise<Metadata> {
  const { pair } = await params;
  return { title: `${pair.toUpperCase()} live`, description: `Harga, bid/ask, dan orderbook live ${pair.toUpperCase()} dari API resmi Indodax.`, alternates: { canonical: `/pasar/${pair.toLowerCase()}`, languages: { 'id-ID': `/pasar/${pair.toLowerCase()}` } }, openGraph: { url: `${SITE_ORIGIN}/pasar/${pair.toLowerCase()}`, type: 'website' } };
}

export default async function MarketPage({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  if (!/^[a-z0-9_]+$/i.test(pair)) notFound();
  try {
    const detail = await getMarketDetail(pair.toLowerCase());
    const { market, depth, trades } = detail;
    return <div className="page-wrap"><div className="detail-head"><div><p className="eyebrow">PASAR / {market.tickerId}</p><h1>{market.symbol}</h1><p className="muted">Snapshot {formatTime(market.updatedAtMs)}</p></div><MarketStatus status={market.status} updatedAtMs={market.updatedAtMs} /></div><section className="detail-price"><span>Harga terakhir</span><strong>{formatIdr(market.last, market.pricePrecision)}</strong><div><span>Bid {formatIdr(market.buy, market.pricePrecision)}</span><span>Ask {formatIdr(market.sell, market.pricePrecision)}</span></div></section><div className="detail-grid"><Orderbook depth={depth} pricePrecision={market.pricePrecision} /><section className="recent-trades"><div className="section-heading"><div><p className="eyebrow">TAPE</p><h2>Trade terbaru</h2></div><span className="count">{trades.length} event</span></div>{trades.slice(0, 12).map((trade) => <div className="trade-row" key={trade.tid}><span className={trade.type}>{trade.type === 'buy' ? 'BELI' : 'JUAL'}</span><strong>{formatIdr(trade.price, market.pricePrecision)}</strong><span>{trade.amount}</span><small>{new Date(toEpochMs(trade.date)).toLocaleTimeString('id-ID')}</small></div>)}</section></div><p className="disclaimer">Data ini bersumber dari API publik Indodax dan dapat terlambat atau gagal. Paper trading bukan hasil nyata dan bukan nasihat keuangan.</p></div>;
  } catch (error) {
    return <div className="page-wrap"><section className="empty-state"><MarketStatus status="error" /><p className="eyebrow">PASAR TIDAK TERSEDIA</p><h1>{pair.toUpperCase()} belum bisa dibaca.</h1><p>{error instanceof Error ? error.message : 'Respons pasar tidak valid.'}</p><p className="muted">Tidak ada angka pengganti yang ditampilkan.</p></section></div>;
  }
}
