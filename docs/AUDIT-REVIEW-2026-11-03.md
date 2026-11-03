# Audit Aplikasi dan Metodologi — Indo Signal

| Item | Nilai |
|---|---|
| Tanggal | **3 November 2026 (WIB)** |
| Baseline produksi | `main` / `23882bc` (`feat: add real-time Jakarta clock`) |
| Branch remediasi lokal | `audit/market-data-methodology-hardening` |
| Status remediasi | **sudah diuji secara lokal; belum di-push, di-merge, atau dideploy** |

## Ringkasan eksekutif

Indo Signal menggunakan Next.js App Router untuk halaman SSR dan API internal, REST publik Indodax untuk ticker serta candle, PostgreSQL untuk state paper/forward-test, dan worker produksi yang dilindungi PostgreSQL advisory lock. Guard penting sudah ada: validasi respons upstream dengan Zod, closed-candle signal pada worker BTC utama, paper-only (tanpa order riil), biaya dan pajak yang tidak dianggap permanen, serta activation gate yang menahan aktivasi tanpa bukti memadai.

Audit menemukan tiga masalah metodologi/representasi berprioritas utama: regime scanner multipair bisa dihitung dari seri yang lebih panjang daripada candle sinyal; pemeriksaan history membiarkan satu atau dua candle hilang; dan halaman performa mengabaikan marked-to-market equity curve saat menghitung max drawdown. Ada pula risiko timestamp upstream jauh ke depan dianggap live, lookup metadata pair berulang, dan pesan error worker mentah pada endpoint status publik.

Perubahan perbaikan dan regresi test sudah diterapkan pada branch lokal. **Tidak ada perubahan production, transaksi, secret, konfigurasi Hostless, maupun database yang dilakukan oleh patch audit ini.**

## Hasil audit runtime dan deployment

### Uji push real-time clock

GitHub Actions untuk commit `23882bc` lulus: [CI run 41613054953](https://github.com/rollinkxx/indosignal/actions/runs/41613054953). Hostless menampilkan deployment `#fa163ad5`, commit `23882bc`, dengan pemicu **via git push**. Itu membuktikan push ke `main` memicu pipeline Hostless.

Pada pemeriksaan dashboard sekitar 16:54 WIB, deployment tersebut masih **Building** setelah kira-kira 8 menit; deployment `#e3f0c1e4` untuk `d76eb8a` tercatat **Superseded**, sedangkan `ae2c3b8` masih **Deployed / LIVE**. Screenshot/log Hostless yang diterima pukul 17:14 WIB kemudian memastikan deployment `#fa163ad5` **Failed / Crashed On Start**, exit code 1. Pesan eksplisitnya: `MIGRATION_DATABASE_URL wajib tersedia di production; DATABASE_URL runtime tidak boleh digunakan sebagai migrator.` Akar masalah terkonfirmasi adalah secret migrator tidak tersedia di environment container; `scripts/migrate.mjs` keluar sebelum membuka koneksi database, jadi migrasi tidak dijalankan dan Next.js belum start. GitHub Actions untuk commit tetap hijau karena workflow menjalankan typecheck, test, build, dan audit dependency, bukan migrasi terhadap DB Hostless atau container start dengan secret production. `/api/ready` 200 yang diamati berasal dari deployment lama yang masih aktif, bukan bukti deployment baru berhasil.

### Scanner dan forward-test produksi

Pada sekitar 16:57 WIB, endpoint status Hostless menunjukkan scanner multipair `running`, `scanOnly: true`, 20 pair, 320 observasi, `gapCount: 0`, heartbeat berumur sekitar 15 detik, dan 27 sinyal buy / 118 sell. Tidak ada order yang dibuat (`paperOrdersCreated: false`). Ini bukti worker observasi aktif, bukan bukti profit atau kesiapan strategi.

Forward-test BTC yang berjalan terpisah berstatus **invalidated**, belum qualified, dengan 8 dari 337 candle yang disyaratkan dan sekitar 7 jam elapsed pada saat observasi. Run itu tidak boleh dihitung sebagai validasi 14 hari. Penyebab invalidasi perlu diperiksa di log internal sebelum run baru/berikutnya dianggap sebagai evidence; status publik tidak menyajikan detail penyebab mentah.

## Perbaikan yang diterapkan pada branch audit

1. **Konsistensi candle/regime:** helper `closedCandlesThrough` membatasi regime pada candle yang sudah ditutup saat keputusan dibuat. Worker BTC dan multipair memakai prefix tersebut; regime multipair tidak lagi dihitung dari seri yang dapat lebih panjang daripada input indikator sinyal.
2. **Integritas backtest history:** normalisasi menolak gap yang menghilangkan satu atau lebih interval candle (dengan toleransi timestamp 1 detik), bukan baru menolak gap yang melebihi tiga timeframe. Backtest ditahan daripada memperlakukan observasi berjauhan sebagai bar berurutan.
3. **Drawdown marked-to-market:** halaman `/performa` sekarang mengirim `equityCurve` per candle ke `performanceMetrics`; penurunan intratrade ikut terwakili walau trade akhirnya ditutup setelah pulih.
4. **Clock-skew freshness:** timestamp ticker lebih dari 30 detik di masa depan ditandai stale; seleksi universe juga menolak timestamp yang melampaui toleransi tersebut.
5. **Optimasi metadata:** bootstrap universe mengambil metadata pair dari cache satu kali alih-alih memanggil lookup per pasar. Ini menghindari pola lookup berulang O(n²) ketika pasar makin banyak.
6. **Minimisasi informasi publik:** endpoint status forward-test dan multipair menyamarkan pesan error operasional mentah; detail tetap untuk log internal.
7. **Tes regresi:** ditambahkan kasus gap satu candle, timestamp masa depan, drawdown di dalam posisi, pemotongan candle tertutup, dan redaksi error.

## Verifikasi lokal

Seluruh pemeriksaan berikut lulus pada branch audit setelah perubahan:

- TypeScript typecheck.
- **12 test files, 74 tests lulus**.
- Market mock guard.
- Docker security static check.
- Production build Next.js.
- `git diff --check`.

Repository tidak mendefinisikan script `lint`; lint formal belum dijalankan. Audit database disposable/staging, restart proof, tes browser service-worker/offline, serta audit dependency berbasis advisori juga belum dijalankan.

## Temuan yang masih terbuka dan prioritas

### P1 — Kebenaran status data pada UI

Halaman pasar SSR mengambil snapshot saat render. Jam real-time yang ditambahkan memperbarui waktu lokal, bukan data pasar. Tanpa polling/refresh state, snapshot yang awalnya berlabel live dapat tetap tampil setelah usang. Rekomendasi: refresh endpoint internal berkala (mis. 15–30 detik), pause ketika tab tersembunyi, hitung ulang freshness, dan tampilkan stale/error ketika refresh gagal. Jam bukan indikator freshness pasar.

### P1 — Forward-test BTC invalidated

Satu run saat audit berstatus invalidated dan baru memiliki 8/337 candle. Cari penyebab persis pada log internal dan validasi kontinuitas sebelum menggunakan run berikutnya. Jangan menganggap elapsed time atau status worker saja sebagai bukti forward-test; syarat cakupan berurutan 14 hari dan konfigurasi fee/tax tetap wajib.

### P2 — PWA offline

Service worker `public/sw.js` tersedia, tetapi audit statis tidak menemukan registrasi melalui `navigator.serviceWorker.register`. Shell offline kemungkinan belum aktif. Tambahkan client registration, uji install/activate/offline pada browser nyata, dan pastikan snapshot harga yang tersimpan selalu diberi label lama/offline, bukan live.

### P2 — Isolasi rate limit

Jika `TRUSTED_PROXY_HEADER` tidak dipasang, fallback identitas `shared-egress` membuat seluruh pengunjung berbagi bucket per route. Pastikan Hostless menimpa header proxy tepercaya (bukan meneruskan nilai klien), verifikasi header sampai ke Next.js, dan pantau 429. Jika identitas klien tidak dapat diverifikasi, terapkan juga batas global dan jangan mempercayai `X-Forwarded-For` mentah.

### P2 — Batas pencarian warm-up universe

Bootstrap scanner hanya menguji sampai 40 kandidat teratas sebelum warm-up, kemudian memilih maksimum 20. Jika banyak kandidat gagal warm-up, pair di luar batas tersebut tidak pernah diperiksa. Catat batas ini sebagai aturan universe atau ubah menjadi pencarian bertahap yang tetap dibatasi request/time budget dan melaporkan jumlah kandidat yang belum diperiksa.

### P2 — Validasi metodologi strategi

Threshold ADX/ATR, EMA, Donchian-volume, RSI, dan Bollinger masih hard-coded. Tes kausalitas memeriksa pemakaian prefix, tetapi tidak membuktikan bahwa nilai parameter memberikan edge. Terapkan versi parameter eksplisit, walk-forward/OOS lintas rezim dan pasangan, sensitivity grid yang cukup, benchmark buy-and-hold, biaya dan slippage konservatif, serta pelaporan ukuran sampel. Jangan mengaktifkan strategi karena backtest tunggal atau win rate saja.

### P2 — Hak akses runtime PostgreSQL

Startup menolak superuser, tetapi belum membuktikan role runtime bukan owner/anggota role migrator atau tidak memiliki DDL. Verifikasi role membership, ownership, serta privilege efektif di staging dan berikan hanya grant minimum. Jangan menguji atau mengubah grant database production sebagai bagian audit ini.

### P3 — Hardening dan konsistensi dokumen

- `/api/health` menyajikan telemetry operasional tanpa autentikasi; pertimbangkan liveness publik yang minimal dan endpoint metrik internal.
- Tambahkan CSP (mulai dengan Report-Only), frame protection, dan HSTS di edge setelah konfigurasi HTTPS dipastikan.
- Selaraskan `TODO.md` dan `plan.md`: fase ditulis belum selesai walau beberapa sistem/test telah diimplementasikan. Tandai status per fase berbasis bukti (implemented, locally verified, staging verified, deployed), bukan checklist yang tidak diperbarui.
- Tambahkan polling/live freshness browser serta pengujian deployment sebagai quality gate terpisah dari CI source.

## Struktur kerja yang disarankan

Pertahankan batas modul yang sudah mulai terbentuk: **adapter sumber data → validasi/normalisasi → domain strategi dan paper → repository PostgreSQL → API read model → UI**. Selanjutnya pisahkan worker menjadi komponen service yang dapat diobservasi dan mudah diuji tanpa mengimpor efek samping startup; gunakan kontrak status/health terpisah untuk liveness, readiness, dan metrik. Hindari membuat UI melakukan request langsung ke Indodax atau menggabungkan API market, strategi, dan persistence menjadi satu route.

## Kesimpulan

Scanner multipair aktif sebagai sistem observasi paper-only dan kontrol penting sudah terlihat. Namun hasil forward-test BTC saat ini belum valid, freshness UI, PWA offline, role runtime DB, dan konfigurasi rate-limit masih perlu dibuktikan. Patch audit lokal memperbaiki sejumlah kesalahan konkret dan semua quality gate yang tersedia lulus; patch tersebut belum ada di `main` dan belum dideploy. Deployment jam real-time terpicu dari push tetapi **gagal karena `MIGRATION_DATABASE_URL` tidak dikonfigurasi di runtime Hostless**. Perbaikan yang aman adalah memasang secret migrator DDL terpisah di Hostless, bukan melemahkan guard atau memakai `DATABASE_URL` runtime.
