# Post-Merge Remediation Audit — Indo Signal

Tanggal: **2026-11-03**
Baseline: `70b38a8` (`main`)
Branch: `fix/post-merge-audit-remediation`

## Ringkasan

Audit pasca-merge menemukan empat jalur yang masih terlalu permisif atau belum lengkap: migrator dapat memakai `DATABASE_URL` runtime, regime mean-reversion dipaksa menjadi `range`, startup scanner menelan kegagalan database, dan pemeriksaan integrity/audit chain belum mengagregasi seluruh mismatch penting. Remediasi source, regression test, dokumentasi, CI workflow, dan pembaruan Zod telah diterapkan. Tidak ada migrasi production, perubahan secret production, backfill evidence, deployment, atau real-money trading.

## Perubahan

- Production migration sekarang wajib memakai `MIGRATION_DATABASE_URL`; fallback ke `DATABASE_URL` hanya dapat dipilih eksplisit pada non-production dengan `ALLOW_RUNTIME_DATABASE_MIGRATION=true`.
- Startup melempar kembali kegagalan migrasi/database setelah logging sehingga proses tidak dianggap sehat ketika scanner gagal dimulai.
- `regimeForStrategy` mengembalikan regime aktual dari candle; worker, backtest, API signals, dan halaman strategi tidak lagi mengubah regime berdasarkan slug.
- Ditambahkan agregator `lib/audit/integrity.mjs` beserta regression tests untuk constraint tidak tervalidasi, orphan, duplicate idempotency, ledger mismatch, dan chain mismatch.
- Audit chain memeriksa fill tanpa pasangan ledger, run mismatch, event kind yang salah, dan coverage event.
- Zod dikunci ke `4.6.7`; `.github/workflows/ci.yml` menjalankan quality gates tanpa credential production.
- Dokumentasi runtime database, migrator, dan Hostless deployment diselaraskan.

## Bukti lokal

Semua gate berikut lulus pada branch ini:

- `pnpm typecheck`
- `pnpm test` — **12 test files, 69 tests**
- `pnpm check:market-mocks`
- `pnpm check:docker-security`
- `pnpm audit --audit-level high` — no known vulnerabilities
- `pnpm build`
- `git diff --check`

## Belum diverifikasi

PostgreSQL disposable/staging belum tersedia untuk menjalankan migrasi, role grants, lock takeover, audit-chain/database-integrity end-to-end, dan proof restart. Docker runtime inspection, eksekusi GitHub Actions, branch protection, deployment staging, dan external immutable/WORM audit anchor juga belum diverifikasi. Database production tidak disentuh.

## Rekomendasi rollout

1. Jalankan migration dan proof database pada staging/disposable dengan `DATABASE_URL` non-superuser serta `MIGRATION_DATABASE_URL` terpisah.
2. Jalankan `pnpm audit:db-integrity` dan `pnpm audit:chain` memakai role read-only; selesaikan orphan atau constraint tidak tervalidasi.
3. Verifikasi image runtime non-root dan migrator credential tidak diwariskan ke proses Next.js.
4. Aktifkan required CI check `quality-gates` dan branch protection setelah satu pull request nyata diverifikasi.
5. Pertahankan activation gate paper/real-money tetap nonaktif sampai forward-test live minimal 14 hari, rekonsiliasi, dan audit anchor eksternal tersedia.
