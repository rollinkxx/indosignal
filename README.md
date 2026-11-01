# Indo Signal

PWA berbahasa Indonesia untuk memantau data pasar publik Indodax. Aplikasi menggunakan Next.js, TypeScript, PostgreSQL (`pg`), dan menampilkan status data live/stale/error secara eksplisit. Ini bukan aplikasi order riil dan tidak memberi nasihat investasi.

## Menjalankan lokal

Gunakan Node.js 22 dan pnpm 10.12.1:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Untuk persistence lokal, salin `.env.example` menjadi `.env.local`, isi `DATABASE_URL` PostgreSQL yang aman, lalu jalankan `corepack pnpm db:migrate`. Jangan masukkan koneksi database atau token ke Git.

## Pemeriksaan

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm check:market-mocks
corepack pnpm build
```

## Hostless

Gunakan Dockerfile dan managed PostgreSQL. `DATABASE_URL` harus dipasang sebagai secret yang ter-link ke app; migrasi skema idempoten berjalan saat container start. Baca [runbook Hostless](docs/HOSTLESS_DEPLOY.md) sebelum merilis. Pertahankan satu replica hingga koordinasi worker lintas instance divalidasi.

Public REST market data tidak memerlukan private trading key. `INDODAX_WS_TOKEN` hanya opsional untuk stream terautentikasi. Strategi otomatis dan order riil tetap nonaktif; jangan aktifkan tanpa seluruh gate biaya, pajak, risiko, dan forward-test.
