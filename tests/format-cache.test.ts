import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { formatClock, formatIdr } from '../lib/format';
import { cached, resetCache } from '../lib/indodax/cache';
import { getMarketDetail, getMarketOverview, getProviderRequestStats, resetIndodaxCaches } from '../lib/indodax/client';
import { pairByTicker, tickerToSnapshot } from '../lib/indodax/normalize';
import type { Pair, Ticker } from '../lib/indodax/schemas';

const sample = (name: string) => JSON.parse(readFileSync(resolve(process.cwd(), 'docs/api-samples', name), 'utf8')) as unknown;

describe('format waktu publik', () => {
  it('menampilkan jam snapshot dalam WIB', () => {
    expect(formatClock(Date.parse('2026-11-01T17:45:57.000Z'))).toBe('00.45.57');
  });
});

describe('price precision dari pairs live', () => {
  it('tidak membulatkan PEPEIDR menjadi Rp 0', () => {
    const pairs = sample('pairs.json') as Pair[];
    const summaries = sample('summaries.json') as { tickers: Record<string, Ticker> };
    const pair = pairByTicker(pairs, 'pepe_idr');
    const ticker = summaries.tickers.pepe_idr;
    expect(pair).toBeDefined();
    expect(ticker).toBeDefined();
    const snapshot = tickerToSnapshot(pair!, 'pepe_idr', ticker!);
    expect(snapshot.pricePrecision).toBe('0.000001');
    expect(formatIdr(snapshot.last, snapshot.pricePrecision)).toMatch(/0,\d{6}/);
    expect(formatIdr(snapshot.last, snapshot.pricePrecision)).not.toContain('Rp 0');
  });
});

describe('cache single-flight', () => {
  it('menjalankan loader sekali untuk concurrent callers', async () => {
    resetCache();
    let calls = 0;
    const loader = async () => { calls += 1; return 'live'; };
    const results = await Promise.all([cached('summary-test', 3_000, loader), cached('summary-test', 3_000, loader)]);
    expect(results).toEqual(['live', 'live']);
    expect(calls).toBe(1);
  });
});

describe('request count per visit', () => {
  it('menghindari pairs/summaries berulang dan detail tidak memanggil overview', async () => {
    const pairs = sample('pairs.json');
    const summaries = sample('summaries.json');
    const depth = sample('depth_btcidr.json');
    const trades = sample('trades_btcidr.json');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      const body = path.endsWith('/pairs') ? pairs : path.endsWith('/summaries') ? summaries : path.endsWith('/depth/btcidr') ? depth : trades;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    resetIndodaxCaches();
    await getMarketOverview();
    expect(getProviderRequestStats()).toEqual({ '/api/summaries': 1, '/api/pairs': 1 });
    await getMarketOverview();
    expect(getProviderRequestStats()).toEqual({ '/api/summaries': 1, '/api/pairs': 1 });
    await getMarketDetail('btc_idr');
    expect(getProviderRequestStats()).toEqual({ '/api/summaries': 1, '/api/pairs': 1, '/api/depth/btcidr': 1, '/api/trades/btcidr': 1 });
    vi.unstubAllGlobals();
  });
});
