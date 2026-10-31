import { z } from 'zod';
import { depthSchema, pairsSchema, serverTimeSchema, summariesSchema, tickerAllSchema, tradesSchema } from './schemas';
import { pairByTicker, tickerToSnapshot, type MarketSnapshot } from './normalize';
import { consumeProviderRequest } from './rate-limit';

const BASE = 'https://indodax.com';
const TIMEOUT_MS = 8_000;

async function requestJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  consumeProviderRequest();
  const response = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json', 'Accept-Language': 'id-ID,id;q=0.9', Referer: 'https://indodax.com/', 'User-Agent': 'indo-signal/0.1 live-market-reader' },
  });
  if (!response.ok) throw new Error(`Indodax ${response.status} pada ${path}`);
  const payload: unknown = await response.json();
  return schema.parse(payload);
}

export async function getMarketOverview(): Promise<{ markets: MarketSnapshot[]; updatedAtMs: number }> {
  const [summaries, pairs] = await Promise.all([
    requestJson('/api/summaries', summariesSchema),
    requestJson('/api/pairs', pairsSchema),
  ]);
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
  const overview = await getMarketOverview();
  const market = overview.markets.find((item) => item.tickerId === tickerId);
  if (!market) throw new Error('Pair tidak ditemukan pada ringkasan live.');
  const [depth, trades] = await Promise.all([
    requestJson(`/api/depth/${market.pairId}`, depthSchema),
    requestJson(`/api/trades/${market.pairId}`, tradesSchema),
  ]);
  return { market, depth, trades };
}

export async function getServerTime() { return requestJson('/api/server_time', serverTimeSchema); }
export async function getTickerAll() { return requestJson('/api/ticker_all', tickerAllSchema); }
