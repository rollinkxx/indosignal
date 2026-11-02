# Live Indodax endpoint smoke test

Checked: **2026-11-03 00:17 WIB** from the current Manus sandbox by running `pnpm check:live` against public HTTPS endpoints. This is a read-only provider check; it did not access an application database or production deployment.

| Endpoint / market | HTTP/response check | Rows | Closed rows | Open row(s) correctly excluded by normalization |
|---|---:|---:|---:|---:|
| `/api/server_time` | Live JSON | — | — | — |
| `/api/summaries` | Live JSON | — | — | — |
| `/api/ticker_all` | Live JSON | — | — | — |
| `/api/pairs` | Live JSON | — | — | — |
| `history_v2`, BTCIDR, 15m | Live JSON + OHLCV/timestamp checks | 13 | 12 | 1 |
| `history_v2`, BTCIDR, 1h | Live JSON + OHLCV/timestamp checks | 13 | 12 | 1 |
| `history_v2`, BTCIDR, 4h | Live JSON + OHLCV/timestamp checks | 13 | 12 | 1 |
| `history_v2`, BTCIDR, 1D | Live JSON + OHLCV/timestamp checks | 13 | 12 | 1 |

The live rows passed finite/positive OHLC checks, high/low consistency, non-negative volume, Unix-seconds timestamp validation, unique and ascending candle timestamps, and requested-range validation. For each timeframe the final row was still open at check time; the client correctly filters it out before backtest or forward-test use.

**Scope limit:** the endpoint was verified from this sandbox's network path only. No deployment hostname or deployment shell was supplied, so this does not prove access from the user's production network, nor does it guarantee future upstream availability. The `check:live` script is repeatable from the deployment environment and fails closed on upstream errors or invalid rows.
