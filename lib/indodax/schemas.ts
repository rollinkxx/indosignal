import { z } from 'zod';

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const numeric = z.union([
  z.string().trim().regex(DECIMAL, 'must be a decimal string').refine((value) => Number.isFinite(Number(value)), 'must be finite'),
  z.number().finite(),
]);
const positive = numeric.refine((value) => Number(value) > 0, 'must be positive');
const nonNegative = numeric.refine((value) => Number(value) >= 0, 'must not be negative');
const percentage = nonNegative.refine((value) => Number(value) <= 100, 'percentage must be at most 100');
const timestamp = z.union([z.string().trim().regex(/^\d{1,16}$/), z.number().int().positive().finite()]);
const pairId = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/i);

export const pairSchema = z.object({
  id: pairId,
  symbol: z.string().trim().min(2).max(40),
  ticker_id: z.string().trim().min(2).max(50),
  base_currency: z.string().trim().min(2).max(20),
  traded_currency: z.string().trim().min(1).max(20),
  traded_currency_unit: z.string().trim().max(20).optional(),
  description: z.string().max(120).optional(),
  price_precision: positive.optional(), pricescale: positive.optional(),
  price_round: positive.optional(), quantity_increment: positive.optional(),
  trade_min_base_currency: nonNegative.optional(), trade_min_traded_currency: nonNegative.optional(),
  trade_fee_percent: percentage.optional(), trade_fee_percent_taker: percentage.optional(), trade_fee_percent_maker: percentage.optional(),
  is_maintenance: z.union([z.boolean(), numeric]).optional(),
  is_market_suspended: z.union([z.boolean(), numeric]).optional(),
}).passthrough();

export const pairsSchema = z.array(pairSchema).min(1).max(2_000).superRefine((pairs, ctx) => {
  const ids = new Set<string>();
  for (const [index, pair] of pairs.entries()) {
    if (ids.has(pair.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'duplicate pair id' });
    ids.add(pair.id);
  }
});

export const tickerSchema = z.object({
  high: positive, low: positive, last: positive, buy: positive, sell: positive,
  vol_idr: nonNegative.optional(), server_time: timestamp,
}).passthrough().superRefine((ticker, ctx) => {
  if (Number(ticker.high) < Number(ticker.low)) ctx.addIssue({ code: 'custom', path: ['high'], message: 'high must be >= low' });
  if (Number(ticker.last) <= 0) ctx.addIssue({ code: 'custom', path: ['last'], message: 'last must be positive' });
});

export const summariesSchema = z.object({ tickers: z.record(z.string(), tickerSchema), prices_24h: z.record(z.string(), numeric), prices_7d: z.record(z.string(), numeric) }).superRefine((value, ctx) => {
  if (Object.keys(value.tickers).length > 2_000 || Object.keys(value.prices_24h).length > 2_000 || Object.keys(value.prices_7d).length > 2_000) ctx.addIssue({ code: 'custom', message: 'upstream ticker count exceeds limit' });
});
export const tickerAllSchema = z.object({ tickers: z.record(z.string(), tickerSchema) }).superRefine((value, ctx) => {
  if (Object.keys(value.tickers).length > 2_000) ctx.addIssue({ code: 'custom', message: 'upstream ticker count exceeds limit' });
});
export const serverTimeSchema = z.object({ timezone: z.string().min(1), server_time: timestamp });
export const depthLevelSchema = z.tuple([positive, positive]);
export const depthSchema = z.object({ buy: z.array(depthLevelSchema).max(500), sell: z.array(depthLevelSchema).max(500) }).superRefine((book, ctx) => {
  for (let i = 1; i < book.buy.length; i += 1) {
    if (Number(book.buy[i - 1][0]) < Number(book.buy[i][0])) ctx.addIssue({ code: 'custom', path: ['buy', i], message: 'bid levels must be descending' });
  }
  for (let i = 1; i < book.sell.length; i += 1) {
    if (Number(book.sell[i - 1][0]) > Number(book.sell[i][0])) ctx.addIssue({ code: 'custom', path: ['sell', i], message: 'ask levels must be ascending' });
  }
  if (book.buy[0] && book.sell[0] && Number(book.buy[0][0]) > Number(book.sell[0][0])) {
    ctx.addIssue({ code: 'custom', path: ['sell', 0], message: 'best bid cannot exceed best ask' });
  }
});
export const tradeSchema = z.object({ tid: z.union([z.string().min(1), z.number().int().nonnegative()]), type: z.enum(['buy', 'sell']), price: positive, amount: positive, date: timestamp });
export const tradesSchema = z.array(tradeSchema).max(2_000);
export const historyCandleSchema = z.object({ Time: timestamp, Open: positive, High: positive, Low: positive, Close: positive, Volume: nonNegative }).superRefine((candle, ctx) => {
  const open = Number(candle.Open), high = Number(candle.High), low = Number(candle.Low), close = Number(candle.Close);
  if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
    ctx.addIssue({ code: 'custom', path: ['High'], message: 'OHLC values are inconsistent' });
  }
});
export const historySchema = z.array(historyCandleSchema).max(40_000);

export type Pair = z.infer<typeof pairSchema>;
export type Ticker = z.infer<typeof tickerSchema>;
export type SummaryResponse = z.infer<typeof summariesSchema>;
export type Depth = z.infer<typeof depthSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export type HistoryCandle = z.infer<typeof historyCandleSchema>;
