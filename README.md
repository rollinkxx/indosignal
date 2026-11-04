# Indo Signal

PWA berbahasa Indonesia untuk memantau data pasar publik Indodax. Aplikasi menggunakan Next.js, TypeScript, PostgreSQL (`pg`), dan menampilkan status data live/stale/error secara eksplisit. Ini bukan aplikasi order riil dan tidak memberi nasihat investasi.

## Menjalankan lokal

Gunakan Node.js 22 dan pnpm 10.34.5:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Untuk persistence lokal, salin `.env.example` menjadi `.env.local`, isi `DATABASE_URL` runtime dan `MIGRATION_DATABASE_URL` migrator secara terpisah, lalu jalankan `corepack pnpm db:migrate`. Fallback lokal ke `DATABASE_URL` hanya boleh diaktifkan eksplisit dengan `ALLOW_RUNTIME_DATABASE_MIGRATION=true`; jangan pernah mengaktifkannya di production. Jangan masukkan koneksi database atau token ke Git.

## Pemeriksaan

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm check:market-mocks
corepack pnpm build
```

## Status & handoff agen

**Status terakhir (4 November 2026):** baseline `main` pada `6f34565` lulus typecheck, 74 tes pada 12 file, pemeriksaan market-mock, pemeriksaan Docker statis, dan production build. Ini adalah hasil untuk baseline tersebut; batch remediasi lokal dari audit sebelumnya belum dipulihkan atau diverifikasi pada checkout ini. Deployment production belum diverifikasi.

Sebelum melanjutkan scanner multipair atau audit, baca [handoff agen](docs/AGENT-HANDOFF.md). Dokumen itu berisi daftar pekerjaan tertunda/selesai, bukti verifikasi dan batasnya, urutan tindak lanjut, serta aturan agar setiap agen memperbarui status di repo setelah perubahan atau temuan baru. Jangan menganggap laporan percakapan lama sebagai bukti bahwa patch sudah ada di branch.

## Hostless

Gunakan Dockerfile dan managed PostgreSQL. Production wajib memasang dua secret terpisah: `DATABASE_URL` untuk role runtime non-superuser dan `MIGRATION_DATABASE_URL` untuk role migrator berhak DDL. Migrasi skema idempoten berjalan sebelum Next.js start dan variabel migrator dihapus sebelum proses aplikasi dimulai. Baca [runbook Hostless](docs/HOSTLESS_DEPLOY.md) sebelum merilis. Pertahankan satu replica hingga koordinasi worker lintas instance divalidasi.

Public REST market data tidak memerlukan private trading key. `INDODAX_WS_TOKEN` hanya opsional untuk stream terautentikasi. Strategi otomatis dan order riil tetap nonaktif; jangan aktifkan tanpa seluruh gate biaya, pajak, risiko, dan forward-test.
