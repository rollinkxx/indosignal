# indo signal — Rencana implementasi dan keputusan desain

## Tujuan dan batasan

`indo signal` adalah aplikasi PWA mobile-first berbahasa Indonesia untuk memantau pasar Indodax dan menjalankan paper trading otomatis dari data publik. Jalur pasar tidak boleh memakai mock, faker, `Math.random`, angka pasar hardcode, atau fixture di produksi. Browser tidak memanggil Indodax langsung; server melakukan ingest, normalisasi, validasi, freshness check, dan menyajikan snapshot live ke UI. v1 tidak memiliki API key privat dan tidak mengirim order nyata.

Implementasi akan bertahap. Fase awal yang dikerjakan sekarang adalah kontrak data live, klien REST terverifikasi, health/freshness state, UI dashboard publik, dan fondasi PWA/SEO. Engine paper trading, persistence penuh, strategi, backtester, dan deployment production tetap harus melewati fase berikutnya dengan bukti masing-masing.

## Pendekatan teknis

- **Runtime web:** Next.js App Router + TypeScript, dengan route server untuk API internal dan SSR untuk halaman publik.
- **Validasi:** Zod untuk respons Indodax dan boundary API internal. Parser menerima variasi timestamp detik/milidetik secara defensif dan tidak mengubah data menjadi nilai buatan.
- **Ingest:** REST publik Indodax sebagai bootstrap/backfill/verifikasi silang; adapter WebSocket disiapkan sebagai sumber utama untuk stream market data setelah token static dikonfigurasi melalui secret. Rate limit internal menggunakan token bucket konservatif maksimum 120 request/menit.
- **Persistence:** SQL langsung melalui driver `pg` di atas managed PostgreSQL untuk candles, market snapshots, paper accounts, orders, fills, decisions, metrics, dan append-only trade log. Redis bukan capability bawaan proyek ini; tahap awal menggunakan database untuk durable state dan cache in-process hanya untuk snapshot non-durable. Redis/pub-sub akan ditambahkan sebagai keputusan infrastruktur terpisah bila worker multi-instance dibutuhkan.
- **Worker:** proses ingest terpisah dari request UI, dapat dijalankan melalui endpoint/command worker pada fase berikutnya. UI selalu menerima status `loading`, `live`, `stale`, atau `error` beserta waktu update terakhir.
- **PWA:** application-owned manifest dan service worker ringan yang hanya melakukan cache shell; data pasar tidak dicache sebagai data baru. Offline menampilkan snapshot terakhir dengan label data lama.
- **SEO:** SSR untuk beranda dan halaman pasar yang hanya menampilkan data publik; metadata route-specific, `robots`, `sitemap`, JSON-LD, dan `manus-routes.json`. Dashboard/akun nantinya diberi `noindex`.

## Desain produk

Tiga arah visual yang dipertimbangkan:

1. **Terminal editorial** — 0,06: dark, tipografi monospaced terukur, panel data seperti workstation trader.
2. **Bursa neon** — 0,04: kontras tinggi dengan aksen hijau-lime dan cyan, fokus pada perubahan harga.
3. **Ledger tenang** — 0,08: slate gelap, amber sebagai sinyal perhatian, banyak ruang untuk membaca metrik risiko.

Pilihan: **Terminal editorial**.

- **Design movement:** editorial data terminal yang menggabungkan disiplin dashboard finansial dengan ritme visual majalah teknologi.
- **Core principles:** data harus terasa dapat diaudit; status live harus terlihat tanpa dekorasi; hierarki informasi mengikuti risiko lalu peluang; setiap aksi punya konteks dan batasan.
- **Color philosophy:** dasar `#090b10` dan slate kebiruan menjaga fokus pada angka; hijau hanya berarti bergerak naik atau aman; amber menandai data basi/peringatan; merah dibatasi untuk error/circuit breaker.
- **Layout paradigm:** satu kolom utama yang mengalir dari status koneksi ke pasar teratas, dengan rail horizontal untuk pair dan bottom navigation di mobile; bukan grid kartu seragam.
- **Signature elements:** garis waktu tipis dengan titik freshness, label status berbentuk capsule kecil, dan accent bar vertikal pada panel yang sedang aktif.
- **Interaction philosophy:** interaksi harus menjawab “apa yang berubah?” sebelum “apa yang bisa saya lakukan?”; aksi berisiko selalu menampilkan batasan dan alasan.
- **Animation:** hanya transisi 120–180ms dan shimmer saat loading; tidak ada animasi yang menyamarkan status stale atau membuat angka terasa hidup saat tidak ada tick baru.
- **Typography:** Geist/Inter untuk body dan heading; IBM Plex Mono untuk angka, timestamp, pair, dan status teknis.
- **Brand essence:** “Sinyal pasar yang jujur untuk trader ritel Indonesia” — teliti, tenang, transparan.
- **Brand voice:** ringkas dan tegas. Contoh: “Data live, bukan tebakan.” dan “Paper trade boleh otomatis; risikonya tetap harus terlihat.”
- **Wordmark/logo:** wordmark lowercase `indo signal` dengan notch miring pada huruf `g`, dipasangkan dengan mark dua garis bid/ask yang tidak bertemu.
- **Signature brand color:** `#c7f36b` lime-chartreuse, dipakai hemat agar mudah dikenali tanpa mengubah dashboard menjadi neon.

## Struktur proyek

```text
app/
  layout.tsx                 # metadata global, font, shell
  page.tsx                   # landing + live market overview SSR
  pasar/[pair]/page.tsx      # detail pair publik
  api/market/route.ts        # snapshot market yang dinormalisasi
  api/health/route.ts        # readiness dan freshness
  manifest.webmanifest/     # application-owned PWA manifest
  robots.ts                  # robots policy
  sitemap.ts                 # sitemap publik
components/
  app-shell.tsx              # shell desktop/mobile dan bottom navigation
  market-overview.tsx        # tabel/rail pair live
  market-status.tsx          # live/stale/error state
  price-chart.tsx            # lightweight chart boundary
lib/
  indodax/
    schemas.ts               # Zod schemas berdasarkan sampel live
    client.ts                # REST fetch + timeout + rate limit
    normalize.ts             # mapping pair/ticker/depth/trades/candles
    websocket.ts              # adapter WS3 dengan recover/offset
  market-store.ts            # snapshot/read model fase awal
  format.ts                  # id-ID currency/time formatting
  config.ts                  # env parsing, public origin
  db.ts                      # PostgreSQL connection pool (`pg`)
docs/
  DECISIONS.md               # asumsi dan trade-off
  DATA_CONTRACT.md           # kontrak data live + freshness
  api-samples/               # respons nyata yang berhasil diambil
  SOURCES.md                 # sumber resmi dan tanggal verifikasi
public/
  manus-routes.json
  icons/
  sw.js
scripts/
  check-no-market-mocks.mjs
  check-live-endpoints.mjs
  capture-indodax-samples.mjs
  migrate.mjs
tests/
  unit/
  integration/

## Alur implementasi

1. **Fase 0 — kontrak dan ingest dasar:** simpan sampel live yang dapat diverifikasi, tulis Zod schema, normalizer, client dengan timeout dan freshness, serta CI guard anti-mock.
2. **Fase 1 — live UI:** SSR shell, API internal, market overview, detail pair, SSE/refresh path, error/stale state, dan PWA shell.
3. **Fase 2 — paper engine:** schema durable, worker, account/risk limits, fill simulation dari orderbook/trade nyata, append-only decisions/fills, dan metrik dengan interval Wilson.
4. **Fase 3 — strategi/backtest:** plugin registry, candle closed-only, backtest nyata, walk-forward, sensitivity, forward-test 14 hari, serta perbandingan backtest/paper.
5. **Fase 4 — SEO/performa:** halaman publik unik, metadata, sitemap/robots/JSON-LD, noindex privat, Lighthouse dan Core Web Vitals.
6. **Fase 5 — hardening/deploy:** restart/reconnect tests, rate limit, security headers, Docker/health contract, checkpoint per fase, dan laporan keterbatasan.

## Batasan yang sedang aktif

- Endpoint yang masih menghasilkan 403 dari jalur curl tidak boleh diperlakukan sebagai sampel valid. Aplikasi harus menampilkan error/stale state untuk data yang belum tersedia.
- Static WebSocket token tidak disalin ke source code. Token hanya berasal dari protected env saat adapter WS diaktifkan.
- Biaya trading dan pajak disimpan sebagai konfigurasi bertanggal dari sumber resmi, bukan konstanta tersembunyi. Perubahan kebijakan harus terlihat di UI.
- Belum ada klaim profit, rekomendasi finansial, atau order riil.
