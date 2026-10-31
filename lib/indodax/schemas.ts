import { z } from 'zod';

const numeric = z.union([z.string(), z.number()]);
const timestamp = z.union([z.string(), z.number()]);

export const pairSchema = z.object({
  id: z.string(), symbol: z.string(), ticker_id: z.string(),
  base_currency: z.string(), traded_currency: z.string(),
  traded_currency_unit: z.string().optional(), description: z.string().optional(),
  price_precision: numeric.optional(), pricescale: numeric.optional(),
  price_round: numeric.optional(), quantity_increment: numeric.optional(),
  trade_min_base_currency: numeric.optional(), trade_min_traded_currency: numeric.optional(),
  trade_fee_percent: numeric.optional(), trade_fee_percent_taker: numeric.optional(),
  trade_fee_percent_maker: numeric.optional(), is_maintenance: z.union([z.boolean(), numeric]).optional(),
  is_market_suspended: z.union([z.boolean(), numeric]).optional(),
}).passthrough();

export const pairsSchema = z.array(pairSchema);

export const tickerSchema = z.object({
  high: numeric, low: numeric, last: numeric, buy: numeric, sell: numeric,
  vol_idr: numeric.optional(), server_time: timestamp,
}).passthrough();

export const summariesSchema = z.object({
  tickers: z.record(tickerSchema),
  prices_24h: z.record(numeric),
  prices_7d: z.record(numeric),
});

export const tickerAllSchema = z.object({ tickers: z.record(tickerSchema) });
export const serverTimeSchema = z.object({ timezone: z.string(), server_time: timestamp });
export const depthLevelSchema = z.tuple([numeric, numeric]);
export const depthSchema = z.object({ buy: z.array(depthLevelSchema), sell: z.array(depthLevelSchema) });
export const tradeSchema = z.object({ tid: z.string(), type: z.enum(['buy', 'sell']), price: numeric, amount: numeric, date: timestamp });
export const tradesSchema = z.array(tradeSchema);

export type Pair = z.infer<typeof pairSchema>;
export type Ticker = z.infer<typeof tickerSchema>;
export type SummaryResponse = z.infer<typeof summariesSchema>;
export type Depth = z.infer<typeof depthSchema>;
export type Trade = z.infer<typeof tradeSchema>;
