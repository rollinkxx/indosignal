import { z } from 'zod';
import { depthSchema, historySchema, pairsSchema, serverTimeSchema, summariesSchema, tickerAllSchema, tradesSchema, type HistoryCandle } from './schemas';
import { pairByTicker, tickerToSnapshot, type MarketSnapshot } from './normalize';
import type { ClosedCandle } from '../paper/types';
import { consumeProviderRequest } from './rate-limit';
import { cached, resetCache } from './cache';

const BASE = 'https://indodax.com';
const TIMEOUT_MS = 8_000;
const PAIRS_TTL_MS = 15 * 60_000;
const SUMMARIES_TTL_MS = 3_000;
type RequestStat = { count: number; errors: number; totalMs: number; maxMs: number };
const requestStats = new Map<string, RequestStat>();

export class IndodaxRequestError extends Error {
  constructor(readonly status: number | undefined, readonly endpoint: string, message: string) { super(message); this.name = 'IndodaxRequestError'; }
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error('upstream response exceeded byte limit');
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error('upstream response exceeded byte limit');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('upstream response exceeded byte limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function requestJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  consumeProviderRequest();
  const pathname = new URL(path, BASE).pathname;
  const endpoint = pathname.replace(/^\/api\/(depth|trades)\/[^/]+$/, '/api/$1/:pair');
  const stat = requestStats.get(endpoint) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
  stat.count += 1;
  requestStats.set(endpoint, stat);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json', 'Accept-Language': 'id-ID,id;q=0.9', Referer: 'https://indodax.com/', 'User-Agent': 'indo-signal/0.1 live-market-reader' },
    });
    if (!response.ok) throw new IndodaxRequestError(response.status, endpoint, `Indodax upstream returned HTTP ${response.status}`);
    let payload: unknown;
    try {
      const maxBytes = endpoint.includes('history_v2') ? 8 * 1024 * 1024 : endpoint.includes('/api/depth/') ? 1024 * 1024 : 5 * 1024 * 1024;
      const body = await boundedResponseText(response, maxBytes);
      payload = JSON.parse(body) as unknown;
    } catch (error) {
      const message = error instanceof Error && error.message.includes('byte limit') ? 'Indodax upstream response exceeded the byte limit' : 'Indodax upstream returned invalid JSON';
      throw new IndodaxRequestError(response.status, endpoint, message);
    }
    try { return schema.parse(payload); } catch { throw new IndodaxRequestError(response.status, endpoint, 'Indodax upstream response failed validation'); }
  } catch (error) {
    stat.errors += 1;
    if (error instanceof IndodaxRequestError) throw error;
    const message = error instanceof Error && error.name === 'TimeoutError' ? 'Indodax upstream request timed out' : 'Indodax upstream request failed';
    throw new IndodaxRequestError(undefined, endpoint, message);
  } finally {
    const elapsed = Date.now() - startedAt;
    stat.totalMs += elapsed;
    stat.maxMs = Math.max(stat.maxMs, elapsed);
  }
}

export function getProviderRequestStats(): Record<string, RequestStat & { averageMs: number }> {
  return Object.fromEntries([...requestStats].map(([path, stat]) => [path, { ...stat, averageMs: stat.count ? stat.totalMs / stat.count : 0 }]));
}
export function resetIndodaxCaches(): void { requestStats.clear(); resetCache(); }
async function getPairs() { return cached('pairs', PAIRS_TTL_MS, () => requestJson('/api/pairs', pairsSchema)); }
async function getSummaries() { return cached('summaries', SUMMARIES_TTL_MS, () => requestJson('/api/summaries', summariesSchema)); }

export async function getPairsMetadata() { return getPairs(); }

export async function getMarketOverview(): Promise<{ markets: MarketSnapshot[]; updatedAtMs: number }> {
  const [summaries, pairs] = await Promise.all([getSummaries(), getPairs()]);
  const markets = Object.entries(summaries.tickers)
    .filter(([, ticker]) => ticker.vol_idr !== undefined)
    .map(([tickerId, ticker]) => {
      const pair = pairByTicker(pairs, tickerId);
      return pair ? tickerToSnapshot(pair, tickerId, ticker) : undefined;
    })
    .filter((market): market is MarketSnapshot => market !== undefined)
    .sort((a, b) => Number(b.volumeIdr24h) - Number(a.volumeIdr24h));
  if (markets.length === 0) throw new Error('Tidak ada pair IDR yang berhasil dipetakan dari respons live Indodax.');
  return { markets, updatedAtMs: Math.max(...markets.map((m) => m.updatedAtMs)) };
}

export async function getMarketDetail(tickerId: string) {
  const [summaries, pairs] = await Promise.all([getSummaries(), getPairs()]);
  const ticker = summaries.tickers[tickerId];
  const pair = pairByTicker(pairs, tickerId);
  const market = ticker && pair ? tickerToSnapshot(pair, tickerId, ticker) : undefined;
  if (!market) throw new Error('Pair tidak ditemukan pada ringkasan live.');
  const [depth, trades] = await Promise.all([
    requestJson(`/api/depth/${market.pairId}`, depthSchema),
    requestJson(`/api/trades/${market.pairId}`, tradesSchema),
  ]);
  return { market, depth, trades };
}

export async function getServerTime() { return requestJson('/api/server_time', serverTimeSchema); }
export async function getTickerAll() { return requestJson('/api/ticker_all', tickerAllSchema); }

export function normalizeHistoryRows(rows: HistoryCandle[], pairId: string, timeframe: string, fromMs: number, toMs: number, nowMs = Date.now()): ClosedCandle[] {
  const intervalMs = timeframe === '1D' ? 86_400_000 : timeframe === '3D' ? 3 * 86_400_000 : timeframe === '1W' ? 7 * 86_400_000 : Number(timeframe) * 60_000;
  if (!['15', '60', '240', '1D', '3D', '1W'].includes(timeframe) || !Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error('Timeframe historis tidak diizinkan.');
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs < 0 || toMs <= fromMs || toMs - fromMs > 365 * 86_400_000) throw new Error('Rentang historis tidak valid atau melebihi 365 hari.');
  if (rows.length === 0) throw new Error('Respons historis Indodax kosong.');
  const candles = rows.map((row) => {
    const rawTime = Number(row.Time);
    if (!Number.isSafeInteger(rawTime) || rawTime <= 0 || rawTime > 10_000_000_000) throw new Error('Timestamp historis di luar format Unix seconds yang diharapkan.');
    const openTimeMs = rawTime * 1000;
    return { pairId, timeframe, openTimeMs, closeTimeMs: openTimeMs + intervalMs, open: row.Open, high: row.High, low: row.Low, close: row.Close, volume: row.Volume, source: 'history_v2' as const };
  }).filter((candle) => candle.closeTimeMs > fromMs && candle.closeTimeMs <= Math.min(toMs, nowMs))
    .sort((a, b) => a.openTimeMs - b.openTimeMs);
  const seen = new Set<number>();
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (seen.has(candle.openTimeMs)) throw new Error('Data historis mengandung candle duplikat.');
    seen.add(candle.openTimeMs);
    const open = Number(candle.open), high = Number(candle.high), low = Number(candle.low), close = Number(candle.close), volume = Number(candle.volume);
    if (![open, high, low, close, volume].every(Number.isFinite) || low <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close)) throw new Error('Data historis mengandung OHLCV yang tidak konsisten.');
    if (index > 0 && candle.openTimeMs - candles[index - 1].openTimeMs > intervalMs + 1_000) throw new Error('Data historis memiliki gap candle; pemrosesan ditahan agar durasi bar tetap valid.');
  }
  if (candles.length === 0) throw new Error('Tidak ditemukan candle historis tertutup pada rentang yang diminta.');
  return candles;
}

export async function getHistoricalCandles(pairId: string, fromMs: number, toMs: number, timeframe = '60'): Promise<ClosedCandle[]> {
  const intervalMs = timeframe === '1D' ? 86_400_000 : timeframe === '3D' ? 3 * 86_400_000 : timeframe === '1W' ? 7 * 86_400_000 : Number(timeframe) * 60_000;
  if (!['15', '60', '240', '1D', '3D', '1W'].includes(timeframe) || !Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Timeframe historis tidak diizinkan.');
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs < 0 || toMs <= fromMs || toMs - fromMs > 365 * 86_400_000) {
    throw new Error('Rentang historis tidak valid atau melebihi 365 hari.');
  }
  const pairs = await getPairs();
  const pair = pairs.find((candidate) => candidate.id === pairId);
  if (!pair) throw new Error(`Pair ${pairId} tidak ditemukan pada respons /api/pairs.`);
  const params = new URLSearchParams({ from: String(Math.floor(fromMs / 1000)), to: String(Math.floor(toMs / 1000)), tf: timeframe, symbol: pair.symbol });
  const rows = await requestJson(`/tradingview/history_v2?${params.toString()}`, historySchema);
  return normalizeHistoryRows(rows, pairId, timeframe, fromMs, toMs);
}

export async function getPairById(pairId: string) {
  return (await getPairs()).find((pair) => pair.id === pairId);
}
