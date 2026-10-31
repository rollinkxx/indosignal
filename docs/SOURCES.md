# Sumber data dan verifikasi

Capture fase 0 dilakukan pada 31 Oktober 2026 UTC melalui request server dari environment proyek. Respons live yang valid disimpan di `docs/api-samples/` dan lolos parsing JSON.

Dokumentasi endpoint resmi berasal dari repositori resmi Indodax. Dokumentasi menyebut base REST `https://indodax.com`, REST publik tanpa API key, batas 180 request/menit, endpoint pairs/ticker/depth/trades/summaries/price increments/server time, serta history OHLC. Dokumentasi WebSocket menetapkan `wss://ws3.indodax.com/ws/`, autentikasi static token, channel market resmi, ping method 7, subscribe method 1, unsubscribe method 2, serta recovery berbasis offset.

Halaman biaya resmi menyatakan detail biaya trading dan all-in-fee perlu mengikuti konfigurasi terbaru Indodax. Halaman tersebut juga menjelaskan perubahan pajak terkait PMK No. 50 Tahun 2025; aplikasi tidak menganggap angka tersebut sebagai konstanta permanen dan wajib menyimpan tanggal sumber saat konfigurasi fee/tax dipakai.

## Respons live yang berhasil disimpan

- `pairs.json` — `GET https://indodax.com/api/pairs` (diverifikasi melalui browser karena curl sempat menerima 403)
- `server_time.json` — `GET https://indodax.com/api/server_time`
- `summaries.json` — `GET https://indodax.com/api/summaries`
- `ticker_all.json` — `GET https://indodax.com/api/ticker_all`
- `depth_btcidr.json` — `GET https://indodax.com/api/depth/btcidr`
- `trades_btcidr.json` — `GET https://indodax.com/api/trades/btcidr`

Hash SHA-256 capture:

- `pairs.json`: `655900919287842d41f5c34197d5852d35a2186e02d375c073e55deeff8219ac`
- `server_time.json`: `d4cf43359c5c64b3c427655abfcba8e9c0ef5e0f5c5fcf7614da43919b05f645`
- `summaries.json`: `80e8580c0aa9a985764271c15aab0fe77f0700bde68126aacedccaae542f882a`
- `ticker_all.json`: `aea6be0abf3739796debea2a62728fa107ecb7a889d5fa15ea208ff9d815945`
- `depth_btcidr.json`: `a8782bd3a5eadd25d7a562dce9d9e11548e0a5507d9ad42202009b79a60a98fd`
- `trades_btcidr.json`: `be5f174705a9b89a3c303960b939dc8623ec547d46887126aacedccaae542f882a`

## Referensi resmi

- [1] https://github.com/btcid/indodax-official-api-docs "Official Documentation for the Indodax APIs and Streams"
- [2] https://raw.githubusercontent.com/btcid/indodax-official-api-docs/master/Public-RestAPI.md "Public REST API"
- [3] https://raw.githubusercontent.com/btcid/indodax-official-api-docs/master/Marketdata-websocket.md "Market Data WebSocket"
- [4] https://help.indodax.com/hc/id/articles/4416646599705-Rincian-Biaya-Transaksi-di-INDODAX "Rincian Biaya Transaksi di INDODAX"
