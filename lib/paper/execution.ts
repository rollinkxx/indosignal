import Decimal from 'decimal.js';
import type { BookLevel, ClosedCandle, FeeConfig, Fill, LimitOrderRequest, MarketOrderRequest, OrderConstraints, PaperSide, ValidatedOrderBook, ValidatedTrade } from './types';

const D = (value: string | number) => new Decimal(value);
const ZERO = '0';

function assertFresh(book: ValidatedOrderBook, nowMs: number) { if (book.status !== 'live' || nowMs - book.updatedAtMs > 30_000) throw new Error('Orderbook stale; paper fill dihentikan.'); }
function rate(fee: FeeConfig, kind: 'maker' | 'taker') { return D(kind === 'maker' ? fee.makerRate : fee.takerRate); }
function tax(fee: FeeConfig) { return D(fee.taxRate); }
function feeTax(quote: Decimal, fee: FeeConfig, kind: 'maker' | 'taker') { const feeAmount = quote.mul(rate(fee, kind)); const taxAmount = quote.mul(tax(fee)); return { feeAmount, taxAmount }; }
function levelsFor(book: ValidatedOrderBook, side: PaperSide) { return side === 'buy' ? book.asks : book.bids; }

export function validateOrderConstraints(price: string | number, baseAmount: string | number, constraints: OrderConstraints): string[] {
  const errors: string[] = [];
  const p = D(price); const q = D(baseAmount);
  if (constraints.priceIncrement && !p.div(D(constraints.priceIncrement)).isInteger()) errors.push('price_increment');
  if (constraints.quantityIncrement && !q.div(D(constraints.quantityIncrement)).isInteger()) errors.push('quantity_increment');
  if (constraints.minimumBase && q.lt(D(constraints.minimumBase))) errors.push('minimum_base');
  if (constraints.minimumQuote && p.mul(q).lt(D(constraints.minimumQuote))) errors.push('minimum_quote');
  return errors;
}

export function simulateMarketFill(order: MarketOrderRequest, book: ValidatedOrderBook, fee: FeeConfig, nowMs: number): Fill {
  assertFresh(book, nowMs);
  const requested = D(order.baseAmount); const levels = levelsFor(book, order.side);
  let remaining = requested; let quote = D(0); let filled = D(0); let best: Decimal | undefined;
  for (const level of levels) {
    if (remaining.lte(0)) break;
    const price = D(level.price); const amount = D(level.amount);
    if (amount.lte(0) || price.lte(0)) continue;
    best ??= price;
    const take = Decimal.min(remaining, amount);
    filled = filled.add(take); quote = quote.add(take.mul(price)); remaining = remaining.sub(take);
  }
  if (remaining.gt(0) || filled.lte(0) || !best) throw new Error('Likuiditas orderbook tidak cukup untuk market fill.');
  const { feeAmount, taxAmount } = feeTax(quote, fee, 'taker');
  const average = quote.div(filled);
  return { eventId: order.idempotencyKey, pairId: order.pairId, side: order.side, baseAmount: filled.toFixed(), quoteAmount: quote.toFixed(), averagePrice: average.toFixed(), feeAmount: feeAmount.toFixed(), taxAmount: taxAmount.toFixed(), slippageBps: average.sub(best).div(best).mul(10_000).abs().toFixed(8), source: 'rest-orderbook', occurredAtMs: nowMs };
}

export function simulateLimitFill(order: LimitOrderRequest, trade: ValidatedTrade, fee: FeeConfig): Fill | null {
  if (trade.pairId !== order.pairId || trade.side === order.side) return null;
  const limit = D(order.limitPrice); const tradePrice = D(trade.price);
  const crossed = order.side === 'buy' ? tradePrice.lte(limit) : tradePrice.gte(limit);
  if (!crossed) return null;
  const filled = Decimal.min(D(order.baseAmount), D(trade.amount));
  if (filled.lte(0)) return null;
  const quote = filled.mul(tradePrice); const { feeAmount, taxAmount } = feeTax(quote, fee, 'maker');
  return { eventId: trade.eventId, pairId: order.pairId, side: order.side, baseAmount: filled.toFixed(), quoteAmount: quote.toFixed(), averagePrice: tradePrice.toFixed(), feeAmount: feeAmount.toFixed(), taxAmount: taxAmount.toFixed(), slippageBps: tradePrice.sub(limit).div(limit).mul(10_000).abs().toFixed(8), source: 'websocket-trade', occurredAtMs: trade.occurredAtMs };
}

export function closedCandleOnly(candle: ClosedCandle, nowMs: number): boolean { return candle.closeTimeMs <= nowMs && candle.closeTimeMs > candle.openTimeMs; }

export function fillTotalCost(fill: Fill): string { return D(fill.quoteAmount).add(fill.feeAmount).add(fill.taxAmount).toFixed(); }
export function fillNetProceeds(fill: Fill): string { return D(fill.quoteAmount).sub(fill.feeAmount).sub(fill.taxAmount).toFixed(); }
