import Decimal from 'decimal.js';
import type { BookLevel, ClosedCandle, FeeConfig, Fill, LimitOrderRequest, MarketOrderRequest, OrderConstraints, PaperSide, ValidatedOrderBook, ValidatedTrade } from './types';

const D = (value: string | number) => new Decimal(value);
const now = () => Date.now();

function validPositive(value: string | number): boolean { try { const parsed = D(value); return parsed.isFinite() && parsed.gt(0); } catch { return false; } }
function assertFeeConfig(fee: FeeConfig) {
  for (const value of [fee.makerRate, fee.takerRate, fee.taxRate]) {
    const rate = D(value);
    if (!rate.isFinite() || rate.lt(0) || rate.gte(1)) throw new Error('Konfigurasi fee/tax tidak valid.');
  }
}
function assertFresh(book: ValidatedOrderBook, nowMs: number) {
  if (book.status !== 'live' || !Number.isFinite(nowMs) || !Number.isFinite(book.updatedAtMs) || nowMs - book.updatedAtMs > 30_000 || book.updatedAtMs - nowMs > 5_000) throw new Error('Orderbook stale atau timestamp tidak valid; paper fill dihentikan.');
  if (!book.pairId || !book.bids.length || !book.asks.length) throw new Error('Orderbook kosong/tidak memiliki identitas pair.');
  const validateLevels = (levels: BookLevel[], side: 'bid' | 'ask') => {
    for (let i = 0; i < levels.length; i += 1) {
      if (!validPositive(levels[i].price) || !validPositive(levels[i].amount)) throw new Error('Orderbook mengandung level harga/volume tidak valid.');
      if (i > 0) {
        const previous = D(levels[i - 1].price), current = D(levels[i].price);
        if ((side === 'bid' && previous.lt(current)) || (side === 'ask' && previous.gt(current))) throw new Error('Urutan level orderbook tidak valid.');
      }
    }
  };
  validateLevels(book.bids, 'bid');
  validateLevels(book.asks, 'ask');
  if (D(book.bids[0].price).gt(book.asks[0].price)) throw new Error('Orderbook crossed; paper fill dihentikan.');
}
function rate(fee: FeeConfig, kind: 'maker' | 'taker') { return D(kind === 'maker' ? fee.makerRate : fee.takerRate); }
function tax(fee: FeeConfig) { return D(fee.taxRate); }
function feeTax(quote: Decimal, fee: FeeConfig, kind: 'maker' | 'taker') { const feeAmount = quote.mul(rate(fee, kind)); const taxAmount = quote.mul(tax(fee)); return { feeAmount, taxAmount }; }
function levelsFor(book: ValidatedOrderBook, side: PaperSide) { return side === 'buy' ? book.asks : book.bids; }

export function validateOrderConstraints(price: string | number, baseAmount: string | number, constraints: OrderConstraints): string[] {
  const errors: string[] = [];
  if (!validPositive(price)) errors.push('invalid_price');
  if (!validPositive(baseAmount)) errors.push('invalid_quantity');
  if (errors.length) return errors;
  const p = D(price), q = D(baseAmount);
  if (constraints.priceIncrement && (!validPositive(constraints.priceIncrement) || !p.div(D(constraints.priceIncrement)).isInteger())) errors.push('price_increment');
  if (constraints.quantityIncrement && (!validPositive(constraints.quantityIncrement) || !q.div(D(constraints.quantityIncrement)).isInteger())) errors.push('quantity_increment');
  if (constraints.minimumBase && (!D(constraints.minimumBase).isFinite() || D(constraints.minimumBase).lt(0) || q.lt(D(constraints.minimumBase)))) errors.push('minimum_base');
  if (constraints.minimumQuote && (!D(constraints.minimumQuote).isFinite() || D(constraints.minimumQuote).lt(0) || p.mul(q).lt(D(constraints.minimumQuote)))) errors.push('minimum_quote');
  return errors;
}

export function simulateMarketFill(order: MarketOrderRequest, book: ValidatedOrderBook, fee: FeeConfig, nowMs: number): Fill {
  assertFresh(book, nowMs);
  assertFeeConfig(fee);
  if (order.pairId !== book.pairId || !order.idempotencyKey || !Number.isFinite(order.createdAtMs) || order.createdAtMs > nowMs + 5_000 || nowMs - order.createdAtMs > 30_000 || !validPositive(order.baseAmount)) throw new Error('Order paper tidak valid atau sudah basi.');
  const requested = D(order.baseAmount), levels = levelsFor(book, order.side);
  let remaining = requested, quote = D(0), filled = D(0), best: Decimal | undefined;
  for (const level of levels) {
    if (remaining.lte(0)) break;
    const price = D(level.price), amount = D(level.amount);
    best ??= price;
    const take = Decimal.min(remaining, amount);
    filled = filled.add(take); quote = quote.add(take.mul(price)); remaining = remaining.sub(take);
  }
  if (remaining.gt(0) || filled.lte(0) || !best) throw new Error('Likuiditas orderbook tidak cukup; partial market fill ditolak.');
  const { feeAmount, taxAmount } = feeTax(quote, fee, 'taker');
  const average = quote.div(filled);
  return { eventId: order.idempotencyKey, pairId: order.pairId, side: order.side, baseAmount: filled.toFixed(), requestedBaseAmount: requested.toFixed(), isPartial: false, quoteAmount: quote.toFixed(), averagePrice: average.toFixed(), feeAmount: feeAmount.toFixed(), taxAmount: taxAmount.toFixed(), slippageBps: average.sub(best).div(best).mul(10_000).abs().toFixed(8), source: 'rest-orderbook', occurredAtMs: nowMs };
}

export function simulateLimitFill(order: LimitOrderRequest, trade: ValidatedTrade, fee: FeeConfig, nowMs = now()): Fill | null {
  assertFeeConfig(fee);
  if (trade.pairId !== order.pairId || trade.side === order.side) return null;
  if (!Number.isFinite(nowMs) || !Number.isFinite(order.createdAtMs) || order.createdAtMs > nowMs + 5_000 || !validPositive(order.baseAmount) || !validPositive(order.limitPrice) || !validPositive(trade.price) || !validPositive(trade.amount) || !Number.isFinite(trade.occurredAtMs) || trade.occurredAtMs > nowMs + 5_000 || nowMs - trade.occurredAtMs > 30_000 || trade.occurredAtMs < order.createdAtMs) return null;
  const limit = D(order.limitPrice), tradePrice = D(trade.price);
  const crossed = order.side === 'buy' ? tradePrice.lte(limit) : tradePrice.gte(limit);
  if (!crossed) return null;
  const requested = D(order.baseAmount), filled = Decimal.min(requested, D(trade.amount));
  if (filled.lte(0)) return null;
  const quote = filled.mul(tradePrice), { feeAmount, taxAmount } = feeTax(quote, fee, 'maker');
  return { eventId: trade.eventId, pairId: order.pairId, side: order.side, baseAmount: filled.toFixed(), requestedBaseAmount: requested.toFixed(), isPartial: filled.lt(requested), quoteAmount: quote.toFixed(), averagePrice: tradePrice.toFixed(), feeAmount: feeAmount.toFixed(), taxAmount: taxAmount.toFixed(), slippageBps: tradePrice.sub(limit).div(limit).mul(10_000).abs().toFixed(8), source: 'websocket-trade', occurredAtMs: trade.occurredAtMs };
}

export function closedCandleOnly(candle: ClosedCandle, nowMs: number): boolean { return candle.closeTimeMs <= nowMs && candle.closeTimeMs > candle.openTimeMs; }
export function fillTotalCost(fill: Fill): string { return D(fill.quoteAmount).add(fill.feeAmount).add(fill.taxAmount).toFixed(); }
export function fillNetProceeds(fill: Fill): string { return D(fill.quoteAmount).sub(fill.feeAmount).sub(fill.taxAmount).toFixed(); }
