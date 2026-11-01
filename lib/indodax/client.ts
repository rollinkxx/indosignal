import { z } from 'zod';
import { depthSchema, historySchema, pairsSchema, serverTimeSchema, summariesSchema, tickerAllSchema, tradesSchema } from './schemas';
import { pairByTicker, tickerToSnapshot, type MarketSnapshot } from './normalize';
import type { ClosedCandle } from '../paper/types';
import { consumeProviderRequest } from './rate-limit';
import { cached, resetCache } from './cache';

const BASE = 'https://indodax.com';
const TIMEOUT_MS = 8_000;
const PAIRS_TTL_MS = 15 * 60_000;
const SUMMARIES_TTL_MS = 3_000;
const requestCounts = new Map<string, number>();

async function requestJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  consumeProviderRequest();
  requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
  const response = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json', 'Accept-Language': 'id-ID,id;q=0.9', Referer: 'https://indodax.com/', 'User-Agent': 'indo-signal/0.1 live-market-reader' },
  });
  if (!response.ok) throw new Error(`Indodax ${response.status} pada ${path}`);
  const payload: unknown = await response.json();
  return schema.parse(payload);
}

export function getProviderRequestStats(): Record<string, number> { return Object.fromEntries(requestCounts.entries()); }
export function resetIndodaxCaches(): void { requestCounts.clear(); resetCache(); }
async function getPairs() { return cached('pairs', PAIRS_TTL_MS, () => requestJson('/api/pairs', pairsSchema)); }
async function getSummaries() { return cached('summaries', SUMMARIES_TTL_MS, () => requestJson('/api/summaries', summariesSchema)); }

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

export async function getHistoricalCandles(pairId: string, fromMs: number, toMs: number, timeframe = '60'): Promise<ClosedCandle[]> {
  const pairs = await getPairs();
  const pair = pairs.find((candidate) => candidate.id === pairId);
  if (!pair) throw new Error(`Pair ${pairId} tidak ditemukan pada respons /api/pairs.`);
  const params = new URLSearchParams({ from: String(Math.floor(fromMs / 1000)), to: String(Math.floor(toMs / 1000)), tf: timeframe, symbol: pair.symbol });
  const rows = await requestJson(`/tradingview/history_v2?${params.toString()}`, historySchema);
  const multiplier = timeframe === '1D' ? 86_400_000 : timeframe === '3D' ? 3 * 86_400_000 : timeframe === '1W' ? 7 * 86_400_000 : Number(timeframe) * 60_000;
  return rows.map((row) => { const openTimeMs = Number(row.Time) * 1000; return { pairId, timeframe, openTimeMs, closeTimeMs: openTimeMs + multiplier, open: row.Open, high: row.High, low: row.Low, close: row.Close, volume: row.Volume, source: 'history_v2' as const }; }).filter((candle) => candle.closeTimeMs <= toMs && candle.closeTimeMs > candle.openTimeMs);
}

export async function getPairById(pairId: string) {
  return (await getPairs()).find((pair) => pair.id === pairId);
}
