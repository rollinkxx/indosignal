import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const curl = promisify(execFile);
const base = 'https://indodax.com';
const headers = ['--header', 'Accept: application/json', '--header', 'Accept-Language: id-ID,id;q=0.9', '--header', 'Referer: https://indodax.com/'];
const nowMs = Date.now();
const nowSec = Math.floor(nowMs / 1000);
const endpoints = ['/api/server_time', '/api/summaries', '/api/ticker_all', '/api/pairs'];
for (const path of endpoints) {
  const { stdout } = await curl('curl', ['--fail-with-body', '--silent', '--show-error', '--location', '--connect-timeout', '5', '--max-time', '15', '--user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36', ...headers, base + path]);
  const body = JSON.parse(stdout);
  if (body === null || body === undefined) throw new Error(`${path} returned empty JSON`);
  console.log(JSON.stringify({ endpoint: path, status: 'live_json' }));
}

const windows = [
  { label: '15m', tf: '15', seconds: 900 },
  { label: '1h', tf: '60', seconds: 3_600 },
  { label: '4h', tf: '240', seconds: 14_400 },
  { label: '1D', tf: '1D', seconds: 86_400 },
];
for (const timeframe of windows) {
  const from = nowSec - timeframe.seconds * 12;
  const query = new URLSearchParams({ symbol: 'BTCIDR', tf: timeframe.tf, from: String(from), to: String(nowSec) });
  const url = `${base}/tradingview/history_v2?${query}`;
  const { stdout } = await curl('curl', ['--fail-with-body', '--silent', '--show-error', '--location', '--connect-timeout', '5', '--max-time', '15', '--user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36', ...headers, url]);
  const rows = JSON.parse(stdout);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${timeframe.label}: history_v2 returned no candle rows`);
  const seen = new Set();
  let previous = -Infinity;
  let closedCount = 0;
  let droppedOpenCount = 0;
  for (const row of rows) {
    const timeSec = Number(row?.Time);
    const open = Number(row?.Open), high = Number(row?.High), low = Number(row?.Low), close = Number(row?.Close), volume = Number(row?.Volume);
    if (!Number.isSafeInteger(timeSec) || timeSec <= 0 || timeSec > 10_000_000_000) throw new Error(`${timeframe.label}: invalid Unix-seconds timestamp`);
    if (![open, high, low, close, volume].every(Number.isFinite) || low <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close)) throw new Error(`${timeframe.label}: invalid OHLCV`);
    if (seen.has(timeSec)) throw new Error(`${timeframe.label}: duplicate candle timestamp ${timeSec}`);
    seen.add(timeSec);
    if (timeSec < previous) throw new Error(`${timeframe.label}: candles are not ascending`);
    previous = timeSec;
    const openMs = timeSec * 1000;
    const closeMs = (timeSec + timeframe.seconds) * 1000;
    if (openMs > nowMs || openMs > nowSec * 1000 || closeMs <= from * 1000 || openMs > nowSec * 1000) throw new Error(`${timeframe.label}: candle is outside the requested from/to range`);
    if (closeMs > nowMs) { droppedOpenCount += 1; continue; }
    closedCount += 1;
  }
  if (closedCount === 0) throw new Error(`${timeframe.label}: no closed candles in live response`);
  console.log(JSON.stringify({ endpoint: '/tradingview/history_v2', symbol: 'BTCIDR', timeframe: timeframe.label, rows: rows.length, closedRows: closedCount, openRowsFilteredByClient: droppedOpenCount, firstTimeSeconds: Number(rows[0].Time), lastTimeSeconds: Number(rows.at(-1).Time), format: 'Unix seconds' }));
}
