# Forward-test 14 hari dan jurnal paper-trade tahan restart

## Tujuan dan batas keselamatan

Runbook ini mendefinisikan forward-test **paper-only** untuk `trend-following`, pair `btcidr` (BTC/IDR), timeframe 1 jam, modal virtual awal Rp10.000.000, dan risiko rencana maksimal 1% ekuitas per posisi. Tidak ada API key privat Indodax, akses akun pengguna, atau order riil. Hasil forward-test tidak otomatis mengaktifkan strategi.

Forward-test berarti keputusan dibuat dari candle yang benar-benar ditutup **setelah run dimulai**, lalu bukti keputusan dan eksekusi simulasi disimpan ke PostgreSQL. Menghitung ulang candle historis sesudah restart tidak boleh dihitung sebagai observasi forward.

## Syarat run yang dapat diaudit

Sebuah run berstatus `eligible_for_review` hanya jika seluruh syarat berikut dipenuhi:

1. **Durasi:** waktu candle tertutup pertama sampai candle terakhir yang diproses sekurangnya 14 × 24 jam.
2. **Cakupan:** minimal 337 candle 1 jam tertutup yang unik dan berurutan untuk memenuhi kedua batas waktu inklusif; tidak ada gap candle yang belum dijelaskan.
3. **Sumber:** setiap candle disimpan dengan pair, timeframe, OHLCV, `history_v2`, waktu close sumber, waktu penerimaan, dan hash/idempotency key. Candle terbuka atau timestamp tidak valid ditolak.
4. **Freshness:** worker hidup dan heartbeat terakhir paling lama 5 menit; orderbook/ticker untuk paper fill harus lolos freshness guard 30 detik. Data stale menghasilkan event block, bukan fill.
5. **Keputusan:** satu keputusan unik per `run + strategy version + pair + candle close`; keputusan `hold`, `buy`, dan `sell` beserta alasannya ikut disimpan.
6. **Eksekusi paper:** jika sinyal memenuhi risiko, fill hanya memakai orderbook resmi yang tervalidasi, biaya taker, batas kas virtual, dan aturan ukuran/stop. Tidak ada posisi short spot. Fill parsial yang belum didukung engine tidak boleh dicatat sebagai fill penuh.
7. **Konsistensi:** keputusan, order, fill, ledger kas, posisi/trade, jurnal, dan cursor candle ditulis dalam satu transaksi PostgreSQL. Retry dengan key sama tidak boleh menambah saldo, posisi, fill, atau trade kedua.
8. **Restart:** setelah proses dimatikan dan dijalankan lagi, run, cursor, keputusan, ledger, posisi, order, fill, serta closed trade harus sama dengan sebelum restart; worker melanjutkan dari cursor terakhir tanpa memproses candle yang sama dua kali.
9. **Gangguan:** candle terlambat di luar toleransi atau gap yang tidak dapat dibuktikan menyebabkan run ditandai `invalidated`/butuh review. Catch-up historis tidak mengisi hari yang terlewat sebagai data live.
10. **Review terpisah:** OOS yang tidak memiliki trade, jumlah trade terlalu kecil, fee/pajak tidak terverifikasi, drawdown melewati ambang, atau bukti restart yang gagal tetap menahan gate. Durasi 14 hari saja tidak cukup untuk mengaktifkan strategi.

## Arsitektur implementasi

- **Migrasi additive dan bernomor:** pertahankan tabel awal. Tambahkan `forward_test_runs`, `forward_test_candles`, `forward_test_events` append-only, serta `paper_cash_ledger`; tambahkan metadata fill masuk dan risk budget ke snapshot posisi. Semua perubahan memiliki unique key dan foreign key yang relevan.
- **Worker Node tunggal:** start melalui lifecycle server produksi, bukan route GET halaman. Gunakan satu replica Hostless yang sudah dipakai aplikasi. Worker memperoleh PostgreSQL advisory lock untuk mencegah dua proses aktif; lock dilepas otomatis saat koneksi/proses mati.
- **Polling:** tiap 60 detik periksa heartbeat dan harga untuk stop; candle 1 jam hanya dievaluasi setelah close. Worker hanya mengambil run dan pair yang ditetapkan di config run.
- **State pemulihan:** PostgreSQL menjadi sumber kebenaran. Posisi/ekuitas adalah read model yang dibangun/diupdate bersama jurnal dan ledger; data RAM hanya cache sementara. `last_processed_close_ms` diperbarui pada transaksi yang sama dengan decision/fill.
- **Idempotensi transaksi:** key deterministik untuk `candle`, `decision`, `order`, `fill`, `cash ledger`, dan `closed trade`. Transaksi mengunci row run/account (`FOR UPDATE`) dan memeriksa key sebelum mengubah state.
- **Status read-only:** endpoint status menampilkan `planned/running/invalidated/completed`, lama run, count candle/decision/trade, gap, heartbeat, last close, dan alasan gate; endpoint ini tidak dapat mengubah state.
- **Gate aktivasi:** hitung durasi/cakupan/heartbeat/gap dari data PostgreSQL, bukan parameter request. Tetap memerlukan backtest/OOS/sensitivitas, konfigurasi fee/pajak yang diverifikasi, review risiko dan persetujuan terpisah sebelum strategi dapat diaktifkan.

## Urutan penerapan

1. Tambahkan migrasi PostgreSQL additive dan update migrator bernomor/idempoten.
2. Implementasikan repository transaksi untuk memulai/memulihkan run, menulis candle/decision/journal, mengisi paper order dari orderbook, memutakhirkan ledger dan posisi, serta menutup trade secara atomik.
3. Buat worker single-instance dengan advisory lock, freshness/gap guard, heartbeat, deduplikasi candle, stop monitor, dan penanganan graceful retry.
4. Mulai satu campaign paper-only dengan modal virtual Rp10.000.000, strategi/version snapshot, BTCIDR 1h, risk 1%, dan fee bertanggal dari `/api/pairs`. Pajak saat ini tidak tervalidasi dari kontrak pair; asumsi nol hanya boleh dilabeli *pre-tax* dan tidak boleh meloloskan activation gate.
5. Tambahkan endpoint status dan hubungkan endpoint backtest ke bukti run persisten. Paparkan alasan aktivasi, bukan hanya boolean.
6. Jalankan unit/integration test PostgreSQL untuk migrasi baru dan lama, transaksi/unique key paralel, stop/fill/accounting, gangguan proses, advisory-lock takeover, idempotensi, dan batas 13 hari 23:59 vs 14 hari.
7. Deploy setelah persetujuan publikasi. Catat waktu awal run dari database; jangan mengklaim hari sudah terpenuhi sebelum cakupan dan waktu persisten memenuhi syarat.
8. Setelah minimum 14 hari, bekukan snapshot hasil dan lakukan review manual. Strategi otomatis tetap nonaktif kecuali seluruh gate dan review risiko menyatakan lulus.

## Kriteria selesai dan bukti

- **Implementasi siap:** typecheck/build/unit test lulus; migrasi diuji pada PostgreSQL kosong dan database versi sebelumnya; test restart benar-benar dijalankan sebagai proses baru; health/status endpoint menunjukkan satu worker ber-lock.
- **Run berjalan:** campaign `running`, heartbeat ≤5 menit, candle pertama setelah start tersimpan, keputusan/jurnal persist, status paper-only terlihat, tidak ada order riil.
- **Forward-test 14 hari tercapai:** durasi ≥14 hari, ≥337 candle unik berurutan, gap=0, jurnal/replay konsisten setelah restart, semua fills punya sumber/fee/asumsi, tidak ada anomali ledger. Nilai ini diverifikasi dari PostgreSQL dan tidak diketik manual.
- **Strategi boleh ditinjau, bukan otomatis aktif:** semua syarat di atas plus OOS yang memenuhi sampel/risiko, sensitivitas yang bermakna, pajak/fee sesuai kebijakan, drawdown dalam batas, dan persetujuan terpisah.

## Status saat runbook dibuat

Repository sudah memiliki tabel awal `virtual_accounts`, `strategies`, `candles`, `paper_orders`, `paper_fills`, `positions`, `closed_trades`, `decision_log`, dan `fee_configs`, tetapi belum memiliki worker forward-test atau transaksi end-to-end. Fungsi jurnal sebelumnya hanya in-memory dan proof restart tidak melakukan restart proses. Belum ada PostgreSQL lokal atau `DATABASE_URL` di sandbox ini, jadi migrasi produksi maupun run 14 hari belum dimulai. Status `0 hari` harus dipertahankan sampai bukti aktual tersedia.
