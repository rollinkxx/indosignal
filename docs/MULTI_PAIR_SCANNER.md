# Scanner multi-pair Indo Signal

## Tujuan dan batas aman

Campaign `scan:v1:trend-following:top-idr-20:60` berjalan terpisah dari forward-test BTCIDR yang sudah ada. Scanner mengevaluasi sinyal Trend Following EMA/ADX pada candle IDR 1 jam yang sudah ditutup dan menyimpan hasilnya sebagai bukti append-only. Scanner ini **scan-only**: ia tidak membuat akun virtual, paper order, fill, posisi, atau order riil. Hasil scanner tidak dihitung sebagai bukti performa trading.

Universe dibekukan saat campaign pertama kali dibuat supaya perubahan daftar pair tidak mengubah sampel di tengah observasi. Pair yang masuk kemudian tidak otomatis ditambahkan ke campaign ini; perlu campaign/version baru untuk mengubah universe.

## Kriteria seleksi awal

- Maksimum 20 pair spot IDR, diurutkan berdasarkan volume IDR 24 jam.
- Volume IDR 24 jam minimal Rp100.000.000.
- Spread bid/ask paling tinggi 150 bps (1,5%).
- Ticker masih live (umur snapshot maksimal 30 detik), pair tidak suspended/maintenance, serta fee maker/taker tersedia dan tidak lebih dari 3%.
- Warm-up sekurang-kurangnya 200 candle tertutup sebelum pair dimasukkan.

Worker memindai tiap pair dalam batch kecil, memakai history REST publik Indodax. Polling worker nominal 60 detik; candle yang sama hanya dicatat sekali. Indodax request limiter internal tetap diberlakukan. Jika data terlambat lebih dari 15 menit, worker menahan keputusan pair tersebut dan menuliskan error agar coverage tidak dianggap live.

## Monitoring

Status campaign tersedia di `/api/forward-test/multi-pair/status`. Endpoint menampilkan universe beku, heartbeat, error/gap, jumlah observasi per pair, keputusan terakhir, serta penanda `scanOnly: true` dan `paperOrdersCreated: false`. Status BTC tetap di `/api/forward-test/status`.

Keputusan `buy` di scanner bukan instruksi order. Sebelum mengubah scanner menjadi paper execution multi-aset, perlu desain kampanye portfolio bersama yang membatasi risiko gabungan dan menguji ledger, alokasi kas, stop, biaya, serta idempotensi lintas pair. Forward-test BTC yang sedang berjalan tidak boleh dicampur atau ditulis ulang.
