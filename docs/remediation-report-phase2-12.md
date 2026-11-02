# Laporan remediation Phase 2–12

Tanggal pekerjaan: **2–3 November 2026**. Branch kerja: `remediation/forensic-audit-2026-11-02`. Tidak ada commit/push, migrasi database, atau deployment yang dilakukan.

## A. Executive summary

Remediation kode untuk lifecycle forward-test, validasi data Indodax, indikator, backtest/risk, API, resource bounds, Docker/database policy, dan tamper-evident audit trail telah diimplementasikan di branch kerja. Quality gates yang dapat dijalankan tanpa database berhasil: install frozen-lockfile, typecheck, **60 unit tests**, build produksi Next.js, static Docker checks, dependency audit, mock-market guard, live smoke test provider dari sandbox, dan benchmark backtest 365 hari.

**Status keseluruhan: PARTIALLY COMPLETE.** Yang belum dapat dibuktikan adalah integrasi PostgreSQL dan status worker di deployment: tidak tersedia `TEST_DATABASE_URL`, `DATABASE_URL`, Docker daemon, maupun target deployment. File migration 0007–0009 disiapkan tetapi **belum diterapkan** ke database mana pun. Strategi tidak dinyatakan profitable; forward-test 14 hari tidak disimulasikan atau di-backfill; real-money trading tidak diaktifkan.

## B. Temuan audit awal yang ditangani

Audit awal mengidentifikasi: startup forward-test tidak terhubung setelah kesiapan migrasi; candle historis/terbuka dan respons upstream tidak tervalidasi cukup; ADX tidak mengikuti Wilder dan Donchian memakai candle pemicu; drawdown mengabaikan unrealized equity; sensitivitas hanya berbasis flag; endpoint compute tidak memiliki batas terdistribusi yang memadai; loop/prefix dan statistik provider berpotensi tidak efisien/tidak bounded; orderbook dan fills tidak cukup fail-closed; runtime Docker/database role belum least-privilege; append-only log belum tamper-evident; serta integration evidence belum mencakup lock takeover dan rekonsiliasi audit.

## C. Temuan yang diperbaiki

| ID / Severity | File/lokasi utama | Penyebab dan perubahan | Bukti | Status |
|---|---|---|---|---|
| P1-01 / Critical — toolchain & supply chain | `package.json`, `pnpm-lock.yaml`, `Dockerfile`, `.dockerignore` | pnpm dikunci ke 10.34.5; instalasi frozen; final image non-root dan hanya dependency produksi; build context menolak secret/VCS/dependency lokal. | `pnpm install --frozen-lockfile`, build, `check:docker-security`, `pnpm audit --audit-level high`. | **FIXED AND VERIFIED** |
| P2-01 / Critical — startup worker | `instrumentation.ts`, `lib/forward-test/worker.ts`, `lib/forward-test/multi-pair-worker.ts`, `lib/forward-test/worker-guards.ts` | Start kedua scanner hanya pada Node production setelah DB non-superuser dan migrasi wajib terdeteksi; API status tidak lagi memulai worker; advisory locks tetap terpisah; state/cursor tetap tersimpan dan event idempotent. | Typecheck/build dan lifecycle unit tests. | **FIXED, NOT VERIFIED** — worker belum dijalankan pada PostgreSQL/deployment. |
| P2-02 / Critical — recovery, lock, candle gaps | `scripts/forward-test-db-proof.ts`, `tests/forward-test.test.ts` | Proof kini mencakup lock takeover setelah koneksi dihancurkan, lock multipair terpisah, coverage chain, append-only, duplikat, posisi/cash/order/fill, gap/lateness. | 6 lifecycle unit tests lulus; proof PostgreSQL **tidak dijalankan**. | **FIXED, NOT VERIFIED** |
| P3-01 / Critical — sumber history Indodax | `lib/indodax/client.ts`, `lib/indodax/schemas.ts`, `scripts/check-live-endpoints.mjs`, `docs/live-smoke-2026-11-03.md` | Allowlist timeframe/rentang; byte limit upstream; normalisasi Unix seconds, ordering, duplicate/gap/OHLCV/range; history kosong/invalid/error ditolak; candle belum tertutup disaring. Smoke test memeriksa 15m/1h/4h/1D. | `pnpm check:live` benar-benar lulus dari sandbox: 4 endpoint umum live JSON; setiap timeframe BTCIDR 13 row, 12 closed, 1 open difilter. | **FIXED AND VERIFIED** untuk jalur jaringan sandbox; jaringan deployment belum tersedia. |
| P4-01 / Critical — indikator kuantitatif | `lib/strategy/indicators.ts`, `lib/strategy/registry.ts`, `lib/strategy/evaluation.ts`, `tests/indicators.test.ts`, `tests/strategy.test.ts` | Wilder RSI/ATR/ADX, +DM/-DM, warm-up, Donchian high/low candle sebelumnya, volume window kausal, regime precomputation; sinyal dibandingkan terhadap evaluasi prefix dan future-mutation. | Tes referensi indikator dan parity/no-look-ahead dalam unit suite. | **FIXED AND VERIFIED** |
| P5-01 / Critical — backtest & risiko | `lib/strategy/backtest.ts`, `lib/paper/metrics.ts`, `app/api/backtest/route.ts`, `tests/backtest.test.ts` | Equity mark-to-market tiap candle, unrealized PnL, biaya/tax config/slippage/spread, gap stop, entry/exit timestamps/exposure, MDD seluruh equity curve, metrik finite, OOS terpisah, 11 sensitivity cases (fee/slippage/spread/risk/stop ATR); gate memeriksa expectancy/PF/DD dan sampel. | Tes backtest/metrics dan stop-parameter stress; 7 backtest tests lulus. | **FIXED AND VERIFIED** sebagai implementasi/metode; bukan bukti profitabilitas. |
| P6-01 / High — API security | `/api/backtest`, `/api/signals`, `/api/market`, status API, admin diagnostic; `lib/server/rate-limit.ts`, `lib/server/response-cache.ts` | Distributed PostgreSQL rate bucket/concurrency lease; tidak mempercayai `X-Forwarded-For`; trusted proxy eksplisit; batas request/candle/cost/body; cache TTL/size; admin token khusus timing-safe; error disanitasi. | 3 API security tests lulus; build/typecheck. | **FIXED AND VERIFIED** pada unit/static checks; fairness proxy production belum diuji. |
| P7-01 / High — performa/memory | `lib/strategy/evaluation.ts`, `lib/strategy/registry.ts`, `lib/indodax/cache.ts`, `lib/server/telemetry.ts`, `scripts/benchmark-backtest.ts` | Menghindari evaluasi prefix kuadratik untuk strategi built-in; cache TTL+kapasitas; statistik per endpoint, tanpa query unik sebagai key; telemetry CPU/memory/latency. | Benchmark lokal 8.760 candle 1h × 5 run: warmup 124,32 ms; median 64,54 ms; RSS maksimum 148.566.016 byte (~142 MiB), RSS iterasi 3–5 relatif datar. | **PARTIALLY FIXED** — benchmark sintetis satu proses; soak test worker lama belum tersedia. Data benchmark ditandai synthetic-only dan tidak digunakan pada production. |
| P8-01 / High — input/orderbook/fill | `lib/indodax/schemas.ts`, `lib/paper/execution.ts`, `lib/paper/types.ts` | Menolak angka nonfinite, OHLC invalid, volume/harga tidak valid, timestamp/depth salah urut/crossed, response terlalu besar, orderbook stale/future, market request basi; partial fill eksplisit dan tidak disamakan dengan full fill. | Contract/provider/paper unit tests, termasuk oversized response. | **FIXED AND VERIFIED** |
| P9-01 / High — Docker & least privilege | `Dockerfile`, `.dockerignore`, `scripts/check-docker-security.mjs`, `scripts/migrations/0009_database_constraints.sql`, `docs/security-remediation.md` | Runtime role dipisah dari migrator dan superuser ditolak; migrator env di-unset sebelum Next start; FK/CHECK/index dan append-only TRUNCATE trigger disiapkan. | Docker static guard, build, typecheck. | **FIXED, NOT VERIFIED** untuk PostgreSQL execution; Docker daemon tidak tersedia, image belum dibangun/diperiksa runtime. |
| P10-01 / High — audit integrity | `lib/audit/hash-chain.mjs`, `lib/forward-test/repository.ts`, migration 0008/0009, `scripts/audit-chain*.mjs`, `scripts/db-integrity-audit.mjs` | Canonical JSON + SHA-256 per-run previous-hash chain; backfill satu kali diserialisasi dengan append; verifier mengecek timestamp/payload/hash, event coverage, order/fill/ledger links, replay base position dan cash; snapshot HMAC dapat diverifikasi offline. | 3 unit tests hash chain lulus; helper `.mjs` lulus `node --check`. | **PARTIALLY FIXED** — belum dijalankan pada DB; snapshot belum dibuat/ditaruh pada storage WORM eksternal. Administrator DB yang mengubah DB dan chain masih dapat merekonstruksi riwayat tanpa anchor eksternal. |
| P11-01 / High — quality gates | Test suite dan package scripts | Ditambahkan unit, provider, lifecycle, API, audit, dan reproducible performance checks. | **60/60 tests**, typecheck lulus, production build lulus, dependency audit tidak melaporkan vulnerability, market mock guard clean, Docker static check pass. | **FIXED AND VERIFIED** untuk checks yang berjalan lokal; integration/load/Docker-runtime tests belum terjalankan. |
| P12-01 / Medium — dokumentasi/status | `docs/security-remediation.md`, `docs/live-smoke-2026-11-03.md`, laporan ini | Runbook, bukti live smoke, batas external anchor, least privilege, dan langkah deploy didokumentasikan tanpa mengklaim DB/prod check yang tidak dilakukan. | Review file dan diff whitespace (`git diff --check`) bersih. | **FIXED AND VERIFIED** |

## D. Belum selesai / residual risks

1. **PostgreSQL integration belum diverifikasi.** Tidak ada `TEST_DATABASE_URL` atau PostgreSQL lokal; proof restart, lock takeover, migrator, FK validation, chain coverage dan ledger reconciliation tidak dijalankan.
2. **Database migration 0007–0009 belum diterapkan.** Status ledger migrasi database tidak diketahui karena tidak ada database yang diakses. Jangan deploy worker sebelum migrasi sukses di staging dan `/api/ready` mengonfirmasi versi wajib.
3. **Worker production belum dibuktikan aktif.** Kode startup sudah tersambung, tetapi proses/heartbeat/cursor deployment tidak dibaca atau diubah.
4. **Smoke history hanya dari sandbox.** Indodax merespons live dari jaringan sandbox pada pemeriksaan ini; akses dari jaringan deployment masih perlu diuji ulang dengan `pnpm check:live` di lingkungan deployment.
5. **Docker image runtime belum diuji.** Binary/daemon Docker tidak tersedia; yang lulus hanya static hardening check dan Next production build.
6. **External immutable audit anchor belum disediakan.** Snapshot signed dibuat lokal oleh command; operator masih harus memegang HMAC key di secret manager terpisah dan mengunggah output ke WORM/immutable storage terpisah.
7. **Forward-test 14 hari dan parameter pajak belum diverifikasi.** Activation gate harus tetap nonaktif sampai observasi live nyata, coverage, pajak, dan kualitas OOS memenuhi syarat.
8. **Tidak ada klaim strategi menguntungkan.** Benchmark sintetis hanya mengukur waktu/RSS engine, tidak menilai return market.

Status temuan yang tersisa menurut istilah laporan: DB integration/migrasi **FIXED, NOT VERIFIED**; WORM anchor dan runtime deployment verification **NOT FIXED / belum dikonfigurasi**; soak test **PARTIALLY FIXED**.

## E. File utama dan commit

Perubahan terkonsentrasi di `instrumentation.ts`, `app/api/**`, `lib/forward-test/**`, `lib/indodax/**`, `lib/paper/**`, `lib/server/**`, `lib/strategy/**`, `lib/audit/**`, `scripts/**`, `tests/**`, `Dockerfile`, `.dockerignore`, `package.json`, `pnpm-lock.yaml`, dan `docs/**`.

Branch: `remediation/forensic-audit-2026-11-02`. **Belum ada commit hash; seluruh pekerjaan masih sebagai perubahan lokal branch dan belum dipush.**

## F.–J. Hasil pengujian

- `pnpm install --frozen-lockfile`: lulus; lockfile konsisten.
- `pnpm typecheck`: lulus.
- `pnpm test`: **11 test files, 60 tests lulus**.
- `pnpm check:market-mocks`: `market mock guard: clean`.
- `pnpm check:docker-security`: lulus; pinned toolchain, non-root final stage, production-only install, secret exclusions.
- `pnpm build`: lulus; Next.js 16.4.3 production build selesai.
- `pnpm audit --audit-level high`: `No known vulnerabilities found`.
- `pnpm check:live`: lulus dari sandbox untuk API live Indodax dan history_v2 4 timeframe; detail di `docs/live-smoke-2026-11-03.md`.
- `pnpm benchmark:backtest`: 365 hari/8.760 candle/jam, 5 iterasi; median 64,54 ms, max RSS sekitar 142 MiB.
- Semua `scripts/*.mjs` melewati `node --check`; `git diff --check` bersih.
- PostgreSQL integration proof, Docker runtime/image scan, dan database audit commands **belum dijalankan** karena dependency lingkungan tidak tersedia.

## K.–N. Performa, migrasi, worker, integritas

- Performa lokal terlihat stabil setelah warmup pada benchmark sintetis; ini bukan soak/load test.
- File migration baru: `0007_api_limits.sql`, `0008_event_hash_chain.sql`, `0009_database_constraints.sql`. Tidak ada migrasi database yang dijalankan.
- Startup production menunggu readiness/migrasi dan role runtime bukan superuser; status runtime aktual tidak diketahui.
- Hash-chain verifier, ledger/cross-link checker, position replay, HMAC snapshot generator/verifier tersedia tetapi belum dijalankan terhadap database.

## O. Residual risk

Risiko terbesar sebelum rollout adalah SQL compatibility/permissions pada data nyata dan deployment network path. FK ditambahkan sebagai `NOT VALID` lalu divalidasi otomatis jika data lama bersih; `audit:db-integrity` harus dijalankan untuk mengidentifikasi constraints yang belum valid sebelum menganggap DB bersih. Migrator memakai role terpisah; runtime grants pada runbook perlu disesuaikan/diuji di staging. HMAC snapshot belum melindungi data sampai dipindahkan ke storage immutable eksternal.

## P. Rekomendasi tahap berikutnya

1. Review branch ini, lalu jalankan migration 0007–0009 dan tiga DB proofs hanya pada database staging/disposable setelah backup.
2. Jalankan `pnpm audit:db-integrity` dan `pnpm audit:chain` memakai role read-only; selesaikan orphan/unvalidated constraints sebelum rollout.
3. Build container dengan Docker/CI, verifikasi `USER nextjs`, secrets/layers, serta pastikan migrator credential hilang dari proses Next.js.
4. Set `DATABASE_URL` non-superuser, `MIGRATION_DATABASE_URL` terpisah, `TRUSTED_PROXY_HEADER` hanya jika edge benar-benar menimpa header, dan token admin opsional yang kuat.
5. Deploy ke staging; ulang `pnpm check:live` dari network deployment; konfirmasi `/api/ready`, dua heartbeat scanner terpisah, cursor, dan lock takeover.
6. Generate snapshot HMAC dengan key dari secret manager yang dikelola terpisah, lalu salin ke WORM/immutable storage. Jadwalkan anchor berkala di luar proses aplikasi.
7. Pertahankan activation gate nonaktif sampai forward-test live nyata sekurangnya 14 hari, pajak terverifikasi, OOS/sensitivity/sampel dan rekonsiliasi memenuhi gate. Tidak ada real-money trading.
