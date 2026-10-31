import { MarketOverview } from '@/components/market-overview';
import { MarketStatus } from '@/components/market-status';
import { getMarketOverview } from '@/lib/indodax/client';
import { formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  try {
    const { markets, updatedAtMs } = await getMarketOverview();
    return <div className="page-wrap">
      <section className="hero"><div className="hero-copy"><p className="eyebrow">INDODAX / PUBLIC MARKET DATA</p><h1>Data live yang tidak berpura-pura.</h1><p className="lede">Ikhtisar pasar IDR dari sumber resmi Indodax. Sinyal dan paper trade harus bisa ditelusuri dari data yang benar-benar terjadi.</p></div><div className="hero-aside"><MarketStatus status={markets[0]?.status ?? 'error'} updatedAtMs={updatedAtMs} /><p>Snapshot terakhir<br /><strong>{formatTime(updatedAtMs)}</strong></p></div></section>
      <MarketOverview markets={markets} />
      <section className="principles"><p className="eyebrow">ATURAN DASAR</p><div className="principle-grid"><div><strong>01 / Tanpa data palsu</strong><span>Jika sumber gagal, layar mengatakan gagal.</span></div><div><strong>02 / Paper, bukan order nyata</strong><span>Eksperimen strategi tidak menyentuh akun Indodax.</span></div><div><strong>03 / Risiko selalu terlihat</strong><span>Winrate tidak pernah berdiri sendirian.</span></div></div></section>
    </div>;
  } catch (error) {
    return <div className="page-wrap"><section className="empty-state"><MarketStatus status="error" /><p className="eyebrow">SUMBER DATA TIDAK TERSEDIA</p><h1>Pasar belum bisa dibaca.</h1><p>{error instanceof Error ? error.message : 'Indodax tidak mengembalikan respons yang valid.'}</p><p className="muted">Tidak ada angka pengganti yang ditampilkan.</p></section></div>;
  }
}
