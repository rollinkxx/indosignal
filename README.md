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

Sebelum mulai mengubah kode, agen wajib membaca [tracker handoff](docs/AGENT-HANDOFF.md), memeriksa branch/working tree/commit terbaru, lalu mencatat pekerjaan sebagai `IN PROGRESS` beserta langkah berikutnya dan bukti selesai yang dibutuhkan. Tracker adalah sumber kebenaran status dan blocker; ringkasan percakapan saja bukan bukti perubahan ada di repo.

Setelah tiap unit kerja bermakna, agen harus menjalankan pemeriksaan relevan, mencatat path/hasil persis/commit dan langkah selanjutnya di tracker, lalu membuat commit kecil dan push checkpoint bila tersedia. Jika konteks atau kredit menipis, hentikan scope baru dan simpan status serta blocker sebelum berhenti. Gunakan status `TODO`, `IN PROGRESS`, `BLOCKED`, atau `DONE`; `DONE` hanya setelah kriteria terkait benar-benar diverifikasi. Tracker memuat template checkpoint siap salin.

## Hostless

Gunakan Dockerfile dan managed PostgreSQL. Production wajib memasang dua secret terpisah: `DATABASE_URL` untuk role runtime non-superuser dan `MIGRATION_DATABASE_URL` untuk role migrator berhak DDL. Migrasi skema idempoten berjalan sebelum Next.js start dan variabel migrator dihapus sebelum proses aplikasi dimulai. Baca [runbook Hostless](docs/HOSTLESS_DEPLOY.md) sebelum merilis. Pertahankan satu replica hingga koordinasi worker lintas instance divalidasi.

Public REST market data tidak memerlukan private trading key. `INDODAX_WS_TOKEN` hanya opsional untuk stream terautentikasi. Strategi otomatis dan order riil tetap nonaktif; jangan aktifkan tanpa seluruh gate biaya, pajak, risiko, dan forward-test.
