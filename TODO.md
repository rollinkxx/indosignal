# TODO — indo signal

## Fase 0 — kontrak data dan ingest live

- [ ] Semua harga, orderbook, trade, dan candle di jalur produksi berasal dari API/WebSocket resmi Indodax secara live; tidak ada mock, faker, `Math.random`, angka hardcode, atau data contoh di UI/production.
- [ ] Jika data gagal atau telat, UI menampilkan loading/error/data basi dan waktu update terakhir; tidak ada fallback data palsu.
- [ ] Respons nyata endpoint disimpan di `docs/api-samples/` sebelum parser ditulis; parser divalidasi dengan Zod; perbedaan respons nyata dari dokumentasi dicatat.
- [ ] CI gagal bila pola mock/faker/random masuk ke jalur data pasar, dan tersedia tes integrasi endpoint live.
- [ ] REST resmi dipakai untuk bootstrap, backfill, dan verifikasi silang dengan rate limit konservatif <=120 request/menit; pasangan dan simbol diambil dari API, bukan daftar pair hardcode.
- [ ] WebSocket market data memakai satu koneksi server, autentikasi token dari env, channel resmi, ping, reconnect, recover, dan offset; browser tidak memanggil Indodax langsung.
- [ ] Freshness guard menghentikan engine per pair setelah tidak update >30 detik dan UI menampilkan banner stale.

## Fase 1 — UI pasar publik dan PWA

- [ ] Halaman beranda dan `/pasar/{pair}` SSR/ISR menampilkan harga, ringkasan 24 jam, status live, dan grafik ringan hanya dari data pasar live yang tersedia.
- [ ] UI mobile-first memiliki bottom navigation, target sentuh >=44px, dark mode, format id-ID, dan label data lama ketika offline.
- [ ] PWA installable dengan shell offline; cache tidak boleh menciptakan data pasar baru.
- [ ] Security header, input validation, rate limit API internal, disclaimer risiko, dan pernyataan tidak berafiliasi dengan Indodax tersedia.

## Fase 2 — paper trading dan metrik transparan

- [ ] Akun virtual persisten/idempoten dengan saldo awal IDR yang dapat diatur dan banyak strategi paralel.
- [ ] Market fill menyapu orderbook nyata dengan slippage; limit fill hanya bila trade nyata melewati harga; price increment, minimum order, biaya, dan pajak diterapkan.
- [ ] Sinyal hanya pada candle close tanpa look-ahead; alasan keputusan dicatat; trade log append-only.
- [ ] Risiko <=1% ekuitas per trade, ATR stop-loss, batas posisi, circuit breaker rugi harian, batas korelasi, dan auto-disable performa buruk.
- [ ] Metrik trade tertutup menampilkan winrate + Wilson CI + sample count, peringatan <30 trade, profit factor, expectancy R, average win/loss, max drawdown, Sharpe/Sortino, equity curve, dan buy-and-hold.

## Fase 3 — strategi dan backtester

- [ ] Registry plugin berversi: EMA20/50/200 + ADX, Donchian + volume, RSI + Bollinger pada sideways, multi-timeframe 4h/1D untuk entry 15m/1h, dan regime gate.
- [ ] Strategi hanya aktif setelah backtest historis nyata dengan biaya, walk-forward/OOS, sensitivitas anti-overfitting, dan forward-test paper minimal 14 hari.
- [ ] Backtest dan paper ditampilkan berdampingan tanpa klaim profit terjamin.
- [ ] Endpoint sinyal observasi dan backtest strategi menggunakan candle tertutup resmi, keputusan tanpa look-ahead, asumsi spot/biaya/ukuran risiko yang transparan, walk-forward/OOS, dan tidak mengirim order riil.

## Fase 4 — SEO dan performa

- [ ] Halaman publik unik: beranda, pasar pair likuid, strategi, edukasi, dan performa paper transparan.
- [ ] Metadata route-specific, canonical saat origin publik tersedia, hreflang id-ID, OG/Twitter, sitemap lastmod, robots, JSON-LD sesuai konten tampak.
- [ ] Dashboard/akun noindex; YMYL menampilkan sumber, tanggal, penulis, dan disclaimer.
- [ ] Target p75 mobile: LCP <2,5 detik, INP <200ms, CLS <0,1; Lighthouse mobile >=90 untuk Performance, SEO, Accessibility, PWA.

## Fase 5 — hardening dan deploy

- [ ] Restart/reconnect menjaga state; staging engine berjalan 24 jam tanpa kehilangan state.
- [ ] Laporan akhir berisi arsitektur, backtest vs paper, skor Lighthouse, keterbatasan, dan langkah berikutnya.
- [ ] Setiap fase memiliki commit/checkpoint dan bukti verifikasi aktual; tidak ada klaim selesai tanpa bukti.
