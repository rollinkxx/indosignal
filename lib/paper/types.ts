export type DecimalInput = string | number;
export type PaperSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';

export type BookLevel = { price: DecimalInput; amount: DecimalInput };
export type ValidatedOrderBook = { pairId: string; updatedAtMs: number; status: 'live'; bids: BookLevel[]; asks: BookLevel[] };
export type ValidatedTrade = { pairId: string; eventId: string; side: PaperSide; price: DecimalInput; amount: DecimalInput; occurredAtMs: number };
export type FeeConfig = { makerRate: DecimalInput; takerRate: DecimalInput; taxRate: DecimalInput; sourceUrl: string; effectiveFrom: string };
export type OrderConstraints = { priceIncrement?: DecimalInput; quantityIncrement?: DecimalInput; minimumBase?: DecimalInput; minimumQuote?: DecimalInput };
export type MarketOrderRequest = { idempotencyKey: string; pairId: string; side: PaperSide; baseAmount: DecimalInput; createdAtMs: number };
export type LimitOrderRequest = MarketOrderRequest & { limitPrice: DecimalInput };
export type Fill = { eventId: string; pairId: string; side: PaperSide; baseAmount: string; quoteAmount: string; averagePrice: string; feeAmount: string; taxAmount: string; slippageBps: string; source: 'rest-orderbook' | 'websocket-trade'; occurredAtMs: number };
export type ClosedTrade = { pnlQuote: DecimalInput; pnlR: DecimalInput; equityAfter: DecimalInput; closedAtMs: number };
export type ClosedCandle = { pairId: string; timeframe: string; openTimeMs: number; closeTimeMs: number; open: DecimalInput; high: DecimalInput; low: DecimalInput; close: DecimalInput; volume: DecimalInput; source: 'history_v2' | 'database' };
