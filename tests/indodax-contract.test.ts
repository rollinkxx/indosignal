import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { depthSchema, pairsSchema, serverTimeSchema, summariesSchema, tickerAllSchema, tradesSchema } from '../lib/indodax/schemas';
import { tickerToSnapshot, toEpochMs } from '../lib/indodax/normalize';

function sample(name: string): unknown { return JSON.parse(readFileSync(resolve(process.cwd(), 'docs/api-samples', name), 'utf8')); }

describe('kontrak respons live Indodax', () => {
  it('menerima sampel pairs aktual', () => expect(pairsSchema.parse(sample('pairs.json'))).toHaveLength(450));
  it('menerima sampel server time aktual', () => expect(serverTimeSchema.parse(sample('server_time.json')).server_time).toBeTypeOf('number'));
  it('menerima sampel summaries aktual', () => expect(Object.keys(summariesSchema.parse(sample('summaries.json')).tickers)).toHaveLength(450));
  it('menerima sampel ticker all aktual', () => expect(Object.keys(tickerAllSchema.parse(sample('ticker_all.json')).tickers)).toHaveLength(450));
  it('menerima sampel depth aktual', () => expect(depthSchema.parse(sample('depth_btcidr.json')).buy).toHaveLength(150));
  it('menerima sampel trades aktual', () => expect(tradesSchema.parse(sample('trades_btcidr.json'))).toHaveLength(500));
  it('menolak depth yang tidak terurut atau crossed', () => { expect(() => depthSchema.parse({ buy: [['10', '1'], ['11', '1']], sell: [['12', '1']] })).toThrow(); expect(() => depthSchema.parse({ buy: [['13', '1']], sell: [['12', '1']] })).toThrow(); });
  it('menolak nilai numerik non-finite pada ticker', () => { expect(() => summariesSchema.parse({ tickers: { btc_idr: { high: 'Infinity', low: '1', last: '2', buy: '1', sell: '2', server_time: 1 } }, prices_24h: {}, prices_7d: {} })).toThrow(); });
});

describe('normalisasi timestamp defensif', () => {
  it('membedakan detik dan milidetik', () => { expect(toEpochMs(1793457008)).toBe(1793457008000); expect(toEpochMs(1793456979727)).toBe(1793456979727); });
  it('menandai ticker dengan timestamp jauh di masa depan sebagai stale', () => {
    const pairs = pairsSchema.parse(sample('pairs.json'));
    const pair = pairs.find((candidate) => candidate.id === 'btcidr')!;
    const ticker = summariesSchema.parse(sample('summaries.json')).tickers[pair.ticker_id];
    expect(tickerToSnapshot(pair, pair.ticker_id, ticker, Number(ticker.server_time) * 1000 - 60_000).status).toBe('stale');
  });
});
