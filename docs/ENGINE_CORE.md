# Paper engine core

Komponen domain paper-trading sudah tersedia sebagai fungsi deterministik yang tidak mengarang market data:

- `lib/paper/execution.ts` menyapu orderbook tervalidasi untuk market fill dan hanya menerima limit fill ketika trade WebSocket tervalidasi melewati harga limit. Semua biaya/tax harus diberikan lewat `FeeConfig` bertanggal dari sumber resmi.
- `lib/paper/risk.ts` menghitung position size dari equity dan jarak entry-stop, stop ATR, batas posisi, circuit breaker rugi harian, dan correlation cap.
- `lib/paper/metrics.ts` menghitung sample count, Wilson CI, winrate, profit factor, expectancy R, average win/loss, drawdown, Sharpe, Sortino, dan equity curve.
- `lib/paper/signals.ts` menolak candle yang belum closed dan membuat idempotency key dari strategy/pair/candle close.
- `lib/paper/journal.ts` menjaga append-only event berdasarkan idempotency key.
- `db/schema.sql` menyediakan tabel additive untuk account, strategy, candle, order, fill, decision log, dan fee config. `pnpm db:migrate` harus dijalankan eksplisit dengan `DATABASE_URL`; tidak ada seed default.

## Batas aktivasi

Core ini belum dianggap engine produksi. Aktivasi baru aman setelah worker WebSocket benar-benar menulis snapshot/event tervalidasi ke persistence, candle `history_v2` tersedia dan diuji, konfigurasi fee/tax resmi bertanggal berhasil disimpan, serta account/strategy flow memiliki authorization dan restart-safe transaction. Selama prasyarat itu belum terpenuhi, UI tidak menampilkan performa paper atau menjanjikan profit.
