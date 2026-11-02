import type { Metadata } from 'next';
import { getHistoricalCandles, getPairById } from '@/lib/indodax/client';
import { runBacktest } from '@/lib/strategy/backtest';
import { performanceMetrics } from '@/lib/paper/metrics';
import { getStrategy } from '@/lib/strategy/registry';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Performa paper trading',
  description: 'Backtest nyata dan status forward-test paper trading indo signal.',
};

const INITIAL_EQUITY = '10000000';

export default async function PerformancePage() {
  const strategy = getStrategy('trend-following');
  let report: {
    trades: number;
    equity: string;
    returnPercent: number;
    drawdown: number;
    period: string;
  } | null = null;
  let error: string | null = null;

  try {
    if (!strategy) throw new Error('Strategi trend-following tidak tersedia.');
    const pair = await getPairById('btcidr');
    if (!pair) throw new Error('Metadata fee BTCIDR tidak tersedia dari Indodax.');
    const candles = await getHistoricalCandles('btcidr', Date.now() - 90 * 86_400_000, Date.now(), '60');
    const takerFee = pair.trade_fee_percent_taker ?? pair.trade_fee_percent;
    if (takerFee === undefined) throw new Error('Fee taker belum tersedia; backtest ditahan.');
    const fee = {
      makerRate: String(Number(pair.trade_fee_percent_maker ?? pair.trade_fee_percent ?? takerFee) / 100),
      takerRate: String(Number(takerFee) / 100),
      taxRate: '0',
      sourceUrl: 'https://indodax.com/api/pairs',
      effectiveFrom: new Date().toISOString(),
    };
    const result = runBacktest(candles, strategy, { initialEquity: INITIAL_EQUITY, fee, riskFraction: '0.01' });
    const metrics = performanceMetrics(result.trades, INITIAL_EQUITY);
    const initial = Number(INITIAL_EQUITY);
    const final = Number(result.equity);
    report = {
      trades: metrics.sampleCount,
      equity: result.equity,
      returnPercent: initial ? (final / initial - 1) * 100 : 0,
      drawdown: metrics.maxDrawdown,
      period: `${result.startMs ? new Date(result.startMs).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) : '—'} – ${result.endMs ? new Date(result.endMs).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) : '—'}`,
    };
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Backtest belum tersedia.';
  }

  return (
    <div className="page-wrap">
      <section className="empty-state">
        <p className="eyebrow">PERFORMA / BACKTEST HISTORIS</p>
        <h1>{report ? 'Backtest sudah berjalan.' : 'Backtest belum dapat dibaca.'}</h1>
        {report ? (
          <>
            <p>Strategi Trend Following pada BTCIDR / candle 1 jam. Periode {report.period}.</p>
            <p>
              Modal awal Rp {Number(INITIAL_EQUITY).toLocaleString('id-ID')} · {report.trades} trade tertutup · equity akhir Rp {Number(report.equity).toLocaleString('id-ID')} · return {report.returnPercent.toFixed(2)}% · max drawdown {(report.drawdown * 100).toFixed(2)}%
            </p>
            <p className="muted">Simulasi spot long-only: sinyal dievaluasi setelah candle tutup, entry/exit paling cepat pada open candle berikutnya, risiko entry dibatasi 1% ekuitas dengan stop ATR, dan tidak membuka posisi short. Slippage tidak dimodelkan; stop dapat terisi pada open berikutnya jika harga gap melewati stop.</p>
          </>
        ) : (
          <p className="muted">{error}</p>
        )}
        <p>Paper trading otomatis tetap nonaktif hingga forward-test minimal 14 hari, pencatatan decision/fill restart-safe, dan pemeriksaan sensitivitas selesai.</p>
        <p><a href="/api/backtest?strategy=trend-following&pair=btcidr&days=90&tf=60">Lihat laporan JSON backtest</a> · <a href="/api/signals?strategy=trend-following&pair=btcidr&tf=60">Lihat sinyal terbaru</a></p>
      </section>
    </div>
  );
}
