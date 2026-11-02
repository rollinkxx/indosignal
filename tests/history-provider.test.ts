import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndodaxRequestError, normalizeHistoryRows, requestJson, resetIndodaxCaches } from '../lib/indodax/client';
import { historyCandleSchema, historySchema } from '../lib/indodax/schemas';
import { z } from 'zod';

const baseMs = 1_700_000_000_000;
const row = (time: number, patch: Record<string, unknown> = {}) => ({ Time: time, Open: '100', High: '110', Low: '90', Close: '105', Volume: '2', ...patch });

afterEach(() => { vi.unstubAllGlobals(); resetIndodaxCaches(); });

describe('Indodax history upstream failures', () => {
  it('fails closed on HTTP 403 and HTTP 500', async () => {
    for (const status of [403, 500]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status })));
      await expect(requestJson('/tradingview/history_v2', historySchema)).rejects.toMatchObject({ name: 'IndodaxRequestError', status });
    }
  });

  it('fails closed on timeout and malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    await expect(requestJson('/tradingview/history_v2', historySchema)).rejects.toMatchObject({ name: 'IndodaxRequestError', status: undefined });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken', { status: 200 })));
    await expect(requestJson('/tradingview/history_v2', historySchema)).rejects.toBeInstanceOf(IndodaxRequestError);
  });

  it('rejects an oversized upstream body before parsing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(1_048_577), { status: 200 })));
    await expect(requestJson('/api/depth/btcidr', z.unknown())).rejects.toMatchObject({ message: 'Indodax upstream response exceeded the byte limit' });
  });

  it('rejects empty history, duplicate timestamps, and invalid timestamp units', () => {
    expect(() => normalizeHistoryRows([], 'btcidr', '60', baseMs, baseMs + 3_600_000, baseMs + 3_600_000)).toThrow(/kosong/);
    const duplicateRows = historySchema.parse([row(baseMs / 1000), row(baseMs / 1000)]);
    expect(() => normalizeHistoryRows(duplicateRows, 'btcidr', '60', baseMs, baseMs + 3_600_000, baseMs + 3_600_000)).toThrow(/duplikat/);
    expect(() => normalizeHistoryRows(historySchema.parse([row(baseMs)]), 'btcidr', '60', baseMs, baseMs + 3_600_000, baseMs + 3_600_000)).toThrow(/Unix seconds/);
  });

  it('rejects inconsistent OHLC and negative volume before values reach the engine', () => {
    expect(() => historyCandleSchema.parse(row(baseMs / 1000, { High: '99' }))).toThrow();
    expect(() => historyCandleSchema.parse(row(baseMs / 1000, { Volume: '-1' }))).toThrow();
    expect(() => historyCandleSchema.parse(row(baseMs / 1000, { Open: 'NaN' }))).toThrow();
  });

  it('returns sorted, unique, closed bars and excludes an open candle', () => {
    const rows = historySchema.parse([row((baseMs + 3_600_000) / 1000), row(baseMs / 1000)]);
    const candles = normalizeHistoryRows(rows, 'btcidr', '60', baseMs, baseMs + 7_200_000, baseMs + 5_400_000);
    expect(candles).toHaveLength(1);
    expect(candles[0].openTimeMs).toBe(baseMs);
    expect(candles[0].closeTimeMs).toBe(baseMs + 3_600_000);
  });

  it('rejects gaps over three intervals and disallowed timeframe/range', () => {
    const rows = historySchema.parse([row(baseMs / 1000), row((baseMs + 4 * 3_600_000) / 1000)]);
    expect(() => normalizeHistoryRows(rows, 'btcidr', '60', baseMs, baseMs + 5 * 3_600_000, baseMs + 5 * 3_600_000)).toThrow(/gap/);
    expect(() => normalizeHistoryRows(rows, 'btcidr', '5', baseMs, baseMs + 5 * 3_600_000, baseMs + 5 * 3_600_000)).toThrow(/Timeframe/);
  });
});
