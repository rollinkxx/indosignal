# Keputusan teknis

## 2026-10-31 — fondasi fase 0

1. Proyek memakai Next.js App Router + TypeScript karena membutuhkan SSR halaman publik, route API server, dan PWA mobile-first dalam satu codebase.
2. Managed database diaktifkan sejak inisialisasi karena paper account, order, fill, decision, dan metrik harus tahan restart. Resource deployment menggunakan PostgreSQL terkelola Hostless; Redis belum diaktifkan karena capability proyek tidak menyediakannya secara langsung. Snapshot live fase pertama bersifat read-through dan tidak dianggap durable trading state.
3. Server menjadi satu-satunya boundary ke Indodax. Browser tidak memanggil domain Indodax langsung. Semua respons eksternal divalidasi sebelum masuk read model UI.
4. Rate limit aplikasi ditetapkan konservatif <=120 request/menit meskipun dokumentasi resmi menyebut batas 180 request/menit. Tujuannya memberi ruang untuk retry/backfill tanpa mendekati batas provider.
5. Parser timestamp menerima detik dan milidetik. Sampel live menunjukkan `server_time.server_time` dalam milidetik, sementara `summaries.tickers[*].server_time` dan `trades[*].date` dalam detik; dokumentasi juga menjelaskan kedua bentuk di bagian berbeda.
6. Pair tidak boleh di-hardcode. Endpoint `/api/pairs` berhasil diverifikasi melalui browser dan disimpan sebagai sampel live berisi 450 pair; runtime tetap harus mengambilnya dari Indodax, bukan membaca fixture.
7. Sampel yang boleh menjadi fixture test adalah enam respons live yang berhasil diambil dan disimpan dalam `docs/api-samples/`: pairs, server time, summaries, ticker all, depth BTC/IDR, dan trades BTC/IDR. Sampel ini tidak boleh diimpor oleh production runtime.
8. Endpoint `price_increments`, `ticker/btcidr`, dan `tradingview/history_v2` masih mengembalikan 403 dari jalur curl pada capture ini. Ini dicatat sebagai blocker verifikasi, bukan alasan untuk membuat fallback palsu; `/api/pairs` tidak lagi blocker setelah verifikasi browser.
9. Biaya dan pajak tidak dipasang sebagai konstanta pasar. UI akan menyebut konfigurasi fee/tax bertanggal dan sumber resmi; nilai hanya diaktifkan setelah halaman resmi berhasil dibaca dan kebijakan yang berlaku dapat ditelusuri.
10. v1 tidak menyimpan API key privat dan tidak mengirim order riil. Semua simulasi fill yang kelak dibuat wajib menggunakan orderbook/trade yang benar-benar diterima dan menolak simulasi saat data stale.
11. Setelah audit, fallback summary-only dihapus. Jika `/api/pairs` gagal, seluruh market overview gagal aman; runtime tidak menebak `pairId` atau `symbol` dari `tickerId`.
12. `/api/health` adalah health upstream market dan mengembalikan non-2xx saat market error/stale. `/api/ready` adalah readiness container yang memeriksa konektivitas PostgreSQL dan dipakai sebagai deployment health path.
13. Origin publik terkonfirmasi dari publish pertama adalah `https://indosignal-mwcfpkru.manus.space`; origin ini dipakai untuk metadata canonical/sitemap/JSON-LD, bukan placeholder.

## 2026-11-01 — target PostgreSQL Hostless

1. Source awal memakai `mysql2` dan SQL mentah, bukan Drizzle ORM. Migrasi menggunakan driver `pg` dan syntax PostgreSQL secara langsung, tanpa memperkenalkan ORM baru.
2. Schema awal PostgreSQL bersifat additive dan idempoten; database Hostless baru mulai kosong. Tidak ada salinan data MySQL lama yang dilakukan.
3. Aplikasi dijalankan satu replica pada tahap awal. Migrasi skema berjalan sebelum server Next.js mulai dan readiness memeriksa koneksi database.
4. Strategy activation dan order riil tetap dinonaktifkan; deployment tidak menerima atau menyimpan API key privat Indodax.

## 2026-11-04 — evaluasi otomatisasi workflow coding agent (M-07)

### Ringkasan keputusan

**Keputusan: TIDAK PERLU MENAMBAH OTOMATISASI BARU PADA SAAT INI.** Pertahankan satu Manus, workflow sequential, GitHub sebagai sumber kebenaran, dan CI yang berjalan pada PR serta push ke `main`. Hanya dokumentasi keputusan yang ditambahkan pada M-07; tidak ada scheduler, trigger, agent kedua, integrasi berbayar, atau job latar baru yang dibuat.

Evaluasi ini berdasarkan kondisi yang diperiksa pada 2026-11-04: `.github/workflows/ci.yml`, `package.json`, hasil M-06, PR/issue/branch GitHub, serta status branch dan ruleset. Workflow CI saat ini berjalan pada `pull_request`, `push` ke `main`, dan `workflow_dispatch`; permissions dibatasi ke `contents: read`; action dipin ke SHA; Node.js 22 dan pnpm 10.34.5 ditetapkan; install memakai frozen lockfile; quality gates mencakup handoff checker, typecheck, unit test, market-mock guard, Docker static security, production build, dan dependency audit. M-06 PR #15 dan post-merge CI keduanya berhasil.

Snapshot GitHub saat evaluasi: tidak ada PR terbuka dan tidak ada issue terbuka; GitHub Issues aktif tetapi belum dipakai sebagai backlog. PR #10–#15 diselesaikan berurutan. `main` belum protected dan repository ruleset berjumlah nol. Ada remote branch non-main yang sudah lama serta branch A-series yang berisi pekerjaan belum terselesaikan; karenanya branch cleanup otomatis tidak aman.

### Penilaian per kategori

#### A. Tambahan GitHub Actions di luar CI saat ini — **Not needed now**

Manfaat mempertahankan workflow sekarang adalah semua gate deterministik yang diperlukan untuk perubahan kode sudah berjalan pada PR dan sesudah merge, dengan checkout penuh agar handoff checker dapat membandingkan base/head. Menambah gate hanya layak bila menutup kegagalan yang benar-benar pernah terjadi dan dapat diuji deterministik.

Gap yang tetap ada sengaja dibatasi: checker tidak memverifikasi kebenaran bukti atau relevansi makna task row; itu memerlukan penilaian manusia dan batasannya sudah didokumentasikan. CI juga belum membangun image Docker sungguhan atau menjalankan integrasi database; pemeriksaan Docker yang ada bersifat statis. Jangan menyamakan hal itu dengan verifikasi production. Image build tetap di A-05 dan database integration tetap di A-03.

**Risiko/biaya/dependensi:** setiap gate baru menambah waktu CI, permukaan dependency, dan pemeliharaan. Image build memerlukan runner/config yang sesuai; database integration memerlukan target disposable/staging yang diotorisasi. Status/evidence yang memerlukan judgement tidak dapat dijadikan klaim valid hanya melalui regex.

**Acceptance bila diajukan lagi:** tunjukkan celah berulang yang dapat direproduksi, gate harus deterministik, tidak membaca secret/production, memiliki regression test, dan waktu/biayanya sebanding dengan risiko yang dikurangi. A-03/A-05 harus lebih dahulu memenuhi prasyarat lingkungannya.

#### B. Scheduled jobs dan auto-resume — **Not needed**

Task agent bersifat finite, sequential, dan memiliki handoff snapshot, tracker, branch, commit serta next action di repository. Sesi baru dapat memulihkan keadaan dengan membaca Git; tidak ada kebutuhan kondisi/event yang harus terus dimonitor. Menjadwalkan Manus untuk auto-resume akan menambah invocation tanpa tugas baru dan berisiko menjalankan aksi dari snapshot yang basi.

**Risiko/biaya/dependensi:** biaya eksekusi, state/race antar sesi, pemeliharaan scheduler, dan risiko melanjutkan sebelum pemeriksaan akses/review. Tidak ada dependency yang membenarkan jadwal atau trigger sekarang.

**Acceptance bila diajukan lagi:** harus ada tugas unattended yang nyata dengan pemilik, jadwal/predicate dan batas kedaluwarsa yang eksplisit; resume harus memeriksa ulang branch, working tree, PR, CI, serta blocker sebelum tindakan eksternal.

#### C. Automated issue assignment — **Not needed**

Backlog kerja agent berada di `docs/AGENT-HANDOFF.md`; issue GitHub aktif tidak ada. Memindahkan assignment ke Issues sekarang akan membuat sumber status kedua tanpa proses triage, owner map, atau volume issue yang perlu diotomatisasi.

**Risiko/biaya/dependensi:** duplikasi status, assignment keliru, token/permission tambahan, serta sinkronisasi backlog. Fitur Issues memang aktif, tetapi itu sendiri bukan alasan untuk memakainya.

**Acceptance bila diajukan lagi:** proyek lebih dahulu mengadopsi issue sebagai sumber task yang kanonik, menetapkan labels/owner/transition yang jelas, dan menguji bahwa assignment tidak bertentangan dengan handoff/GitHub PR.

#### D. PR reminders — **Defer**

Tidak ada PR terbuka atau backlog review pada snapshot evaluasi; PR M-series terbaru diproses sequential. Belum ada SLA review atau daftar reviewer tetap yang dapat dipakai untuk menentukan kapan reminder pantas dikirim.

**Risiko/biaya/dependensi:** spam, ping pihak yang salah, notifikasi berulang, dan kebutuhan pemeliharaan bot/token. Bergantung pada kebijakan owner tentang reviewer dan waktu tunggu.

**Acceptance bila diajukan lagi:** owner menetapkan reviewer serta SLA; automation hanya mengingatkan PR yang masih terbuka setelah SLA, berhenti ketika ada review/merge, idempotent, dan diuji pada PR fixture sebelum diaktifkan.

#### E. Stale-branch checks/cleanup — **Defer; report-only terlebih dahulu**

Inventarisasi menemukan banyak remote branch selain `main`, termasuk branch historis yang sudah merged dan branch A-series seperti `audit/remediation-continuation-2026-11-04` serta `hostless-deploy`. Branch yang tampak lama belum tentu aman dihapus; sebagian memuat pekerjaan audit/deployment yang belum selesai dan berada di luar scope M-series.

**Risiko/biaya/dependensi:** penghapusan dapat membuang recovery point atau pekerjaan A-series yang belum dipindahkan ke PR. Dibutuhkan kebijakan usia, pengecualian, owner, serta cara mendeteksi referensi/PR aktif.

**Acceptance bila diajukan lagi:** mulai dengan laporan read-only; definisikan umur stale dan pengecualian untuk PR aktif/A-series; verifikasi merge/backup untuk setiap branch; tidak menghapus otomatis sebelum kebijakan disetujui dan uji dry-run terbukti aman.

#### F. Periodic repository/application health checks — **Defer**

CI sudah memeriksa source/build pada perubahan. Aplikasi memiliki `/api/health` dan `/api/ready`, tetapi pemeriksaan berkala terhadap endpoint live akan memerlukan keputusan target, otorisasi, dan pemisahan staging/production. A-03 (database disposable), A-04 (Hostless/deployment evidence), dan A-05 (image/runtime check) masih memiliki bukti atau lingkungan yang belum tersedia.

**Risiko/biaya/dependensi:** false alarm, ketergantungan jaringan/credential, beban pada provider/database, dan kebingungan antara readiness, CI, dan kesehatan production. Tidak ada background health job dibuat.

**Acceptance bila diajukan lagi:** target staging/disposable diotorisasi, pemeriksaan read-only dan rate-limited, tidak memakai secret production, mempunyai threshold/owner eskalasi, serta membedakan hasil CI, readiness, dan production health.

#### G. Multi-agent orchestration — **Not needed**

Instruksi master menetapkan satu Manus dan sequential workflow; M-01–M-06 dapat diselesaikan oleh satu agent dengan checkpoint dan PR terpisah. Belum ada data throughput, antrean paralel, atau pekerjaan independen yang membenarkan biaya koordinasi tambahan.

**Risiko/biaya/dependensi:** konflik branch/file, duplikasi riset, review agregasi, konteks dan permission tambahan, serta biaya orchestration. Tidak ada agent kedua atau orchestrator ditambahkan.

**Acceptance bila diajukan lagi:** ukur bottleneck yang tidak dapat diatasi dengan satu agent; batasi tugas parallel yang tidak berbagi state; tetapkan ownership, isolation, acceptance dan biaya; bandingkan kualitas/lead time dengan baseline sequential.

#### H. External task/project-tracker integration — **Not needed**

GitHub sudah menyediakan branch, PR, CI, review, merge evidence, issue capability, dan repository handoff. Tidak ada kebutuhan organisasi atau alur lintas sistem yang belum terlayani. Integrasi eksternal akan menggandakan sumber status dan menambah risiko credential serta sinkronisasi.

**Acceptance bila diajukan lagi:** harus ada kebutuhan wajib lintas tim yang tidak dapat dipenuhi GitHub, satu sistem tetap dinyatakan kanonik, sinkronisasi memiliki idempotency/error handling, dan biaya/permission disetujui.

#### I. Branch protection/required checks — **Defer untuk keputusan owner**

Pada saat diperiksa, `main` tidak protected dan tidak ada ruleset; PR #15 tetap diproses normal setelah seluruh CI sukses. Ini adalah celah governance yang nyata, tetapi mengaktifkan protection dapat mengubah hak merge/kontribusi semua pengguna dan perlu kebijakan owner tentang jumlah review serta exception. M-07 tidak mengubah setting tersebut.

**Manfaat:** mencegah merge sebelum check yang diwajibkan hijau dan membuat aturan PR dapat ditegakkan oleh GitHub.

**Risiko/biaya/dependensi:** salah memilih nama required check atau review policy dapat memblokir semua merge; perlu owner yang dapat mengelola exceptions. Jangan mengaktifkan bypass/admin override sebagai pengganti policy.

**Acceptance bila owner memutuskan menerapkan:** pilih `CI/quality-gates` sebagai status check setelah konfirmasi nama stabil; tetapkan review policy; buktikan PR dengan CI merah tidak dapat merge dan PR hijau memenuhi aturan; dokumentasikan emergency path yang terkontrol. Tidak ada setting yang diubah dalam M-07.

### Hasil akhir

Tidak ada kandidat yang memenuhi kebutuhan untuk **diimplementasikan sekarang**. Pertahankan CI dan handoff yang telah ada; pilih **Defer** untuk reminder, stale-branch reporting, periodic health checks, dan branch protection sampai prasyarat/kebijakan terukur tersedia; pilih **Not needed** untuk scheduler/auto-resume, automated issue assignment, multi-agent orchestration, dan external tracker. Keputusan ini dapat ditinjau ulang bila volume PR/issue atau kebutuhan staging berubah. Jangan mengubah backlog A-series menjadi DONE karena M-series selesai.
