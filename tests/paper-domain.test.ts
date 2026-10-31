import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateLimitFill, simulateMarketFill } from '../lib/paper/execution';
import { performanceMetrics } from '../lib/paper/metrics';
import { assertAppendOnly } from '../lib/paper/journal';
import { assessRisk, positionSizeForRisk, stopPrice } from '../lib/paper/risk';
import type { Depth } from '../lib/indodax/schemas';
import type { JournalEvent } from '../lib/paper/journal';

const depth = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/api-samples/depth_btcidr.json'), 'utf8')) as Depth;
const fee = { makerRate: '0.001', takerRate: '0.002', taxRate: '0.001', sourceUrl: 'https://example.invalid/test-only', effectiveFrom: '2026-01-01' };
const book = { pairId: 'btcidr', updatedAtMs: 1_800_000_000_000, status: 'live' as const, bids: depth.buy.slice(0, 3).map(([price, amount]) => ({ price, amount })), asks: depth.sell.slice(0, 3).map(([price, amount]) => ({ price, amount })) };

describe('paper execution', () => {
  it('menyapu level ask dari orderbook live dan menghitung biaya', () => { const fill = simulateMarketFill({ idempotencyKey: 'order-1', pairId: 'btcidr', side: 'buy', baseAmount: '0.02000000', createdAtMs: book.updatedAtMs }, book, fee, book.updatedAtMs); expect(Number(fill.baseAmount)).toBeGreaterThan(0); expect(Number(fill.quoteAmount)).toBeGreaterThan(0); expect(fill.source).toBe('rest-orderbook'); });
  it('hanya mengisi limit ketika trade nyata melewati limit', () => { const noFill = simulateLimitFill({ idempotencyKey: 'order-2', pairId: 'btcidr', side: 'buy', baseAmount: '0.01', createdAtMs: book.updatedAtMs, limitPrice: '1' }, { pairId: 'btcidr', eventId: 'trade-1', side: 'sell', price: '2', amount: '0.01', occurredAtMs: book.updatedAtMs }, fee); expect(noFill).toBeNull(); });
});

describe('paper risk and metrics', () => {
  it('menghasilkan stop ATR dan position size yang dibatasi risiko', () => { expect(stopPrice('buy', '100', '5', '2')).toBe('90'); expect(positionSizeForRisk('10000', '100', '90', '0.01')).toBe('10'); });
  it('memblokir rugi harian dan menghitung Wilson warning', () => { const assessment = assessRisk({ maxRiskFraction: '0.01', atrMultiple: '2', maxConcurrentPositions: 3, maxDailyLossFraction: '0.03', maxCorrelation: '0.8' }, { equity: '10000', dailyPnl: '-400', concurrentPositions: 1, pairCorrelations: {} }, 'btcidr'); expect(assessment.allowed).toBe(false); expect(assessment.reasons).toContain('daily_loss_circuit_breaker'); const metrics = performanceMetrics([{ pnlQuote: '10', pnlR: '1', equityAfter: '10010', closedAtMs: 1 }, { pnlQuote: '-5', pnlR: '-0.5', equityAfter: '10005', closedAtMs: 2 }]); expect(metrics.sampleCount).toBe(2); expect(metrics.warning).toBeDefined(); expect(metrics.wilson95[0]).toBeGreaterThanOrEqual(0); });
});

describe('append-only journal', () => {
  it('idempotensi mencegah event duplikat', () => { const event: JournalEvent = { idempotencyKey: 'decision:1', accountId: 'account-1', strategyId: 'strategy-1', pairId: 'btcidr', kind: 'decision', occurredAtMs: 1, payload: { action: 'hold' } }; const once = assertAppendOnly([], event); expect(assertAppendOnly(once, event)).toHaveLength(1); });
});
