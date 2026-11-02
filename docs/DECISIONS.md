# Keputusan teknis

## 2026-10-31 — fondasi fase 0

1. Proyek memakai Next.js App Router + TypeScript karena membutuhkan SSR halaman publik, route API server, dan PWA mobile-first dalam satu codebase.
2. Managed database diaktifkan sejak inisialisasi karena paper account, order, fill, decision, dan metrik harus tahan restart. Resource deployment menggunakan PostgreSQL terkelola Hostless; Redis belum diaktifkan karena capability proyek tidak menyediakannya secara langsung. Snapshot live fase pertama bersifat read-through dan tidak dianggap durable trading state.
3. Server menjadi satu-satunya boundary ke Indodax. Browser tidak memanggil domain Indodax langsung. Semua respons eksternal divalidasi sebelum masuk read model UI.
4. Rate limit aplikasi ditetapkan konservatif <=120 request/menit meskipun dokumentasi resmi menyebut batas 180 request/menit. Tujuannya memberi ruang untuk retry/backfill tanpa mendekati batas provider.
5. Parser timestamp menerima detik dan milidetik. Sampel live menunjukkan `server_time.server_time` dalam milidetik, sementara `summaries.tickers[*].server_time` dan `trades[*].date` dalam detik; dokumentasi juga menjelaskan kedua bentuk di bagian berbeda.
6. Pair tidak boleh di-hardcode. Endpoint `/api/pairs` berhasil diverifikasi melalui browser dan disimpan sebagai sampel live berisi 450 pair; runtime tetap harus mengambilnya dari Indodax, bukan membaca fixture.
7. Sampel yang boleh menjadi fixture test adalah enam respons live yang berhasil diambil dan disimpan dalam `docs/api-samples/`: pairs, server time, summaries, ticker all, depth BTC/IDR, dan trades BTC/IDR. Sampel ini tidak boleh diimpor oleh production runtime.
8. Endpoint `price_increments`, `ticker/btcidr`, dan `tradingview/history_v2` masih mengembalikan 403 dari jalur curl pada capture ini. Ini dicatat sebagai blocker verifikasi, bukan alasan untuk membuat fallback palsu; `/api/pairs` tidak lagi blocker setelah verifikasi browser.
9. Biaya dan pajak tidak dipasang sebagai konstanta pasar. UI akan menyebut konfigurasi fee/tax bertanggal dan sumber resmi; nilai hanya diaktifkan setelah halaman resmi berhasil dibaca dan kebijakan yang berlaku dapat ditelusuri.
10. v1 tidak menyimpan API key privat dan tidak mengirim order riil. Semua simulasi fill yang kelak dibuat wajib menggunakan orderbook/trade yang benar-benar diterima dan menolak simulasi saat data stale.
11. Setelah audit, fallback summary-only dihapus. Jika `/api/pairs` gagal, seluruh market overview gagal aman; runtime tidak menebak `pairId` atau `symbol` dari `tickerId`.
12. `/api/health` adalah health upstream market dan mengembalikan non-2xx saat market error/stale. `/api/ready` adalah readiness container yang memeriksa konektivitas PostgreSQL dan dipakai sebagai deployment health path.
13. Origin publik terkonfirmasi dari publish pertama adalah `https://indosignal-mwcfpkru.manus.space`; origin ini dipakai untuk metadata canonical/sitemap/JSON-LD, bukan placeholder.

## 2026-11-01 — target PostgreSQL Hostless

1. Source awal memakai `mysql2` dan SQL mentah, bukan Drizzle ORM. Migrasi menggunakan driver `pg` dan syntax PostgreSQL secara langsung, tanpa memperkenalkan ORM baru.
2. Schema awal PostgreSQL bersifat additive dan idempoten; database Hostless baru mulai kosong. Tidak ada salinan data MySQL lama yang dilakukan.
3. Aplikasi dijalankan satu replica pada tahap awal. Migrasi skema berjalan sebelum server Next.js mulai dan readiness memeriksa koneksi database.
4. Strategy activation dan order riil tetap dinonaktifkan; deployment tidak menerima atau menyimpan API key privat Indodax.
