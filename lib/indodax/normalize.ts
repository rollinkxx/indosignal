import type { Pair, Ticker } from './schemas';

export type MarketStatus = 'loading' | 'live' | 'stale' | 'error';
export type MarketSnapshot = {
  pairId: string;
  tickerId: string;
  symbol: string;
  name?: string;
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

export function toEpochMs(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error('timestamp tidak valid');
  return n < 10_000_000_000 ? n * 1000 : n;
}

export function toDecimalString(value: string | number): string {
  const text = String(value).trim();
  if (!text || !Number.isFinite(Number(text))) throw new Error('angka pasar tidak valid');
  return text;
}

export function tickerToSnapshot(pair: Pair | undefined, tickerId: string, ticker: Ticker, nowMs = Date.now()): MarketSnapshot {
  const updatedAtMs = toEpochMs(ticker.server_time);
  const ageMs = Math.max(0, nowMs - updatedAtMs);
  return {
    pairId: pair?.id ?? tickerId.replaceAll('_', ''),
    tickerId,
    symbol: pair?.symbol ?? tickerId.replaceAll('_', '').toUpperCase(),
    name: undefined,
    last: toDecimalString(ticker.last), buy: toDecimalString(ticker.buy), sell: toDecimalString(ticker.sell),
    high24h: toDecimalString(ticker.high), low24h: toDecimalString(ticker.low),
    volumeIdr24h: toDecimalString(ticker.vol_idr ?? '0'),
    updatedAtMs, source: 'rest', status: ageMs > 30_000 ? 'stale' : 'live',
  };
}

export function pairByTicker(pairs: Pair[], tickerId: string): Pair | undefined {
  return pairs.find((pair) => pair.ticker_id === tickerId);
}
