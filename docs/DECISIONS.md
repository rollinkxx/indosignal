# Keputusan teknis

## 2026-10-31 — fondasi fase 0

1. Proyek memakai Next.js App Router + TypeScript karena membutuhkan SSR halaman publik, route API server, dan PWA mobile-first dalam satu codebase.
2. Managed database diaktifkan sejak inisialisasi karena paper account, order, fill, decision, dan metrik harus tahan restart. Database platform MySQL-compatible; Redis belum diaktifkan karena capability proyek tidak menyediakannya secara langsung. Snapshot live fase pertama bersifat read-through dan tidak dianggap durable trading state.
3. Server menjadi satu-satunya boundary ke Indodax. Browser tidak memanggil domain Indodax langsung. Semua respons eksternal divalidasi sebelum masuk read model UI.
4. Rate limit aplikasi ditetapkan konservatif <=120 request/menit meskipun dokumentasi resmi menyebut batas 180 request/menit. Tujuannya memberi ruang untuk retry/backfill tanpa mendekati batas provider.
5. Parser timestamp menerima detik dan milidetik. Sampel live menunjukkan `server_time.server_time` dalam milidetik, sementara `summaries.tickers[*].server_time` dan `trades[*].date` dalam detik; dokumentasi juga menjelaskan kedua bentuk di bagian berbeda.
6. Pair tidak boleh di-hardcode. Endpoint `/api/pairs` berhasil diverifikasi melalui browser dan disimpan sebagai sampel live berisi 450 pair; runtime tetap harus mengambilnya dari Indodax, bukan membaca fixture.
7. Sampel yang boleh menjadi fixture test adalah enam respons live yang berhasil diambil dan disimpan dalam `docs/api-samples/`: pairs, server time, summaries, ticker all, depth BTC/IDR, dan trades BTC/IDR. Sampel ini tidak boleh diimpor oleh production runtime.
8. Endpoint `price_increments`, `ticker/btcidr`, dan `tradingview/history_v2` masih mengembalikan 403 dari jalur curl pada capture ini. Ini dicatat sebagai blocker verifikasi, bukan alasan untuk membuat fallback palsu; `/api/pairs` tidak lagi blocker setelah verifikasi browser.
9. Biaya dan pajak tidak dipasang sebagai konstanta pasar. UI akan menyebut konfigurasi fee/tax bertanggal dan sumber resmi; nilai hanya diaktifkan setelah halaman resmi berhasil dibaca dan kebijakan yang berlaku dapat ditelusuri.
10. v1 tidak menyimpan API key privat dan tidak mengirim order riil. Semua simulasi fill yang kelak dibuat wajib menggunakan orderbook/trade yang benar-benar diterima dan menolak simulasi saat data stale.
