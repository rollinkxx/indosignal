# Kontrak data live Indodax

Kontrak ini dibangun dari dokumentasi resmi dan respons live yang tersimpan di `docs/api-samples/`. Fixture test boleh membaca file tersebut, tetapi production runtime wajib memanggil API/WebSocket resmi dan tidak boleh membaca folder sampel.

## Prinsip umum

Semua respons eksternal dianggap tidak tepercaya. HTTP non-2xx, JSON invalid, schema mismatch, nilai numerik tidak terbaca, atau timestamp tidak masuk akal menghasilkan state `error` dan tidak mengganti snapshot terakhir yang valid. Snapshot yang lebih tua dari 30 detik untuk pair aktif diberi state `stale`; engine pair tersebut harus berhenti.

Angka harga, volume, amount, dan depth diterima sebagai string atau number hanya di boundary parser lalu dinormalisasi ke representasi desimal yang aman. Untuk perhitungan keuangan gunakan decimal arithmetic, bukan floating point biner tanpa kontrol pembulatan.

### `GET /api/pairs`

Respons berupa array pair. Capture live yang diverifikasi melalui browser berisi 450 item dengan `id`, `symbol`, `ticker_id`, `base_currency`, `traded_currency`, precision/increment, minimum order, status maintenance/suspended, dan fee fields. Mapping ini adalah sumber resmi untuk menghubungkan `ticker_id` seperti `btc_idr` dengan `pair_id` seperti `btcidr` dan simbol history seperti `BTCIDR`.

## REST live

### `GET /api/server_time`

Respons berupa object dengan `timezone: string` dan `server_time: integer`. Sampel live menunjukkan `server_time` dalam milidetik sejak Unix epoch. Normalizer mengubahnya menjadi `updatedAtMs` tanpa mengubah angka sumber lain.

### `GET /api/summaries`

Respons berupa object dengan `tickers`, `prices_24h`, dan `prices_7d`. Ketiga map memakai key yang berbeda: ticker memakai bentuk seperti `btc_idr`, sedangkan harga historis memakai bentuk seperti `btcidr`. Ticker berisi `buy`, `sell`, `high`, `low`, `last`, `vol_idr`, asset-specific volume seperti `vol_btc`, `name`, dan `server_time`. Field asset-specific volume tidak diasumsikan selalu bernama sama; `vol_idr` adalah basis universe pair IDR.

### `GET /api/ticker_all`

Respons berupa `{ tickers: Record<tickerId, ticker> }`. Sampel live berisi 450 ticker. `server_time` pada ticker sampel berupa detik sejak epoch, berbeda dari endpoint server time. Normalizer mengubah detik ke milidetik.

### `GET /api/depth/{pair_id}`

Respons berupa `{ buy: [price, amount][], sell: [price, amount][] }`. Sampel live berisi 150 level di masing-masing sisi dan kedua nilai pada tuple berupa string. Normalizer memberi tipe `DepthLevel { price: DecimalString; amount: DecimalString }` serta mempertahankan urutan provider.

### `GET /api/trades/{pair_id}`

Respons berupa array trade dengan `tid: string`, `type: "buy" | "sell"`, `price: string`, `amount: string`, dan `date: string`. Sampel live berisi 500 trade. `date` pada sampel berupa detik Unix. `tid` dipakai sebagai idempotency key.

### Endpoint yang belum terverifikasi di capture

`/api/price_increments`, `/api/ticker/{pair_id}`, dan `/tradingview/history_v2` mengembalikan 403 dari jalur curl pada capture ini. Parser/schema dan fitur yang membutuhkan endpoint tersebut harus tetap disabled atau error sampai respons live berhasil diperoleh. Tidak boleh memakai field dari dokumentasi sebagai pengganti respons runtime.

## WebSocket live

Endpoint resmi `wss://ws3.indodax.com/ws/` memakai static token dari protected env. Setelah koneksi, server mengirim request authentication dengan token. Subscribe menggunakan method `1`, unsubscribe `2`, ping `7`. Channel yang digunakan adalah `market:summary-24h`, `market:trade-activity-{pair}`, `market:order-book-{pair}`, dan `chart:tick-{pair}`.

Pesan stream umumnya berada pada `result.channel` dan `result.data`. Trade activity berupa array `[pair, epochSeconds, sequence, side, price, idrVolume, assetVolume]`. Chart tick berupa `[epochSeconds, sequence, price, volume]`. Summary 24h berupa `[pair, epochSeconds, last, low, high, tMinus24h, idrVolume, assetVolume]`. Orderbook memakai object dengan `pair`, `ask`, dan `bid`; setiap level memiliki price dan volume field.

Adapter harus menyimpan `offset` terakhir per channel. Setelah reconnect, subscribe ulang dengan `recover: true` dan offset terakhir. Jika recovery gagal atau offset gap tidak dapat ditutup, adapter menandai pair sebagai stale/error dan meminta backfill REST saat endpoint tersedia.

## Internal read model

```ts
type MarketStatus = 'loading' | 'live' | 'stale' | 'error';

type MarketSnapshot = {
  pairId: string;
  tickerId: string;
  symbol: string;
  last: string;
  buy: string;
  sell: string;
  high24h: string;
  low24h: string;
  volumeIdr24h: string;
  updatedAtMs: number;
  source: 'rest' | 'websocket';
  status: MarketStatus;
  error?: string;
};
```

`symbol`, `pairId`, dan `tickerId` hanya boleh berasal dari mapping endpoint pairs ketika mapping tersedia. Untuk ticker summaries yang sudah memiliki ticker ID, normalizer tidak menebak simbol yang belum diverifikasi.

## Freshness dan UI

- `loading`: belum ada snapshot valid untuk pair.
- `live`: update valid diterima dan umurnya <=30 detik.
- `stale`: tidak ada update valid >30 detik; tampilkan label “Data lama” dan timestamp terakhir.
- `error`: request gagal, schema tidak cocok, atau recovery tidak berhasil; tampilkan alasan singkat dan waktu snapshot terakhir jika ada.

Tidak ada nilai default numerik untuk harga, volume, candle, atau metrik. Komponen harus menghilangkan angka atau menampilkan placeholder status, bukan mengisi nol atau data demo.
