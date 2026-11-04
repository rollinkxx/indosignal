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

Sebelum mengubah kode, baca [instruksi agen](AGENTS.md), [backlog](TODO.md), [template prompt resume](docs/AGENT-RESUME-TEMPLATE.md), lalu [resume snapshot dan tracker handoff](docs/AGENT-HANDOFF.md). Fetch `origin` dan verifikasi default branch, main SHA, branch/working tree/commit, PR, review, CI, required checks, dan proteksi branch sebelum melanjutkan atau merge. Repo/GitHub adalah sumber kebenaran untuk apa yang sudah dikerjakan—tautan percakapan hanya konteks untuk intent dan keputusan.

Untuk meneruskan pekerjaan dari percakapan sebelumnya, gunakan [template prompt resume](docs/AGENT-RESUME-TEMPLATE.md): sertakan tautan percakapan sebagai konteks saja. Agen harus merekonsiliasi klaim lama terhadap Git/GitHub dan melanjutkan task belum selesai paling awal dalam urutan yang dinyatakan; jangan mengulang pekerjaan yang sudah terverifikasi. Setelah tiap unit kerja bermakna, catat file, bukti/command, jumlah test, SHA, batas verifikasi, satu langkah berikutnya, dan blocker di tracker; commit/push checkpoint. Jangan menunggu peringatan kredit—checkpoint di setiap milestone, terutama sebelum berhenti atau berganti agen. PR memakai [.github/pull_request_template.md](.github/pull_request_template.md) untuk memeriksa status dan bukti handoff. CI mewajibkan PR yang mengubah source/config menambah atau mengubah baris task di handoff (perubahan kosmetik saja tidak cukup); PR dokumentasi saja dikecualikan. Gate ini memeriksa pencatatan status, bukan mutu kode, deployment, atau perilaku production. Gunakan format ringkas laporan akhir pada template resume; PR dan tracker tetap menjadi sumber bukti, bukan formulir laporan paralel.

Tracker memakai status `TODO`, `IN PROGRESS`, `BLOCKED`, `AWAITING APPROVAL`, dan `DONE` sesuai definisi serta transisi di handoff. `AWAITING APPROVAL` berarti review/approval manusia yang diwajibkan belum tercatat; CI hijau, commit, atau PR terbuka tidak menggantikannya. Deployment memiliki approval terpisah. CI handoff hanya memvalidasi adanya perubahan task row untuk source/config, bukan makna status atau kebenaran evidence.

## Hostless

Gunakan Dockerfile dan managed PostgreSQL. Production wajib memasang dua secret terpisah: `DATABASE_URL` untuk role runtime non-superuser dan `MIGRATION_DATABASE_URL` untuk role migrator berhak DDL. Migrasi skema idempoten berjalan sebelum Next.js start dan variabel migrator dihapus sebelum proses aplikasi dimulai. Baca [runbook Hostless](docs/HOSTLESS_DEPLOY.md) sebelum merilis. Pertahankan satu replica hingga koordinasi worker lintas instance divalidasi.

Public REST market data tidak memerlukan private trading key. `INDODAX_WS_TOKEN` hanya opsional untuk stream terautentikasi. Strategi otomatis dan order riil tetap nonaktif; jangan aktifkan tanpa seluruh gate biaya, pajak, risiko, dan forward-test.
