import type { ClosedCandle } from './types';

export type DecisionRecord = { idempotencyKey: string; strategyId: string; pairId: string; candleCloseTimeMs: number; action: 'buy' | 'sell' | 'hold'; reasons: string[]; createdAtMs: number };
export function latestClosedCandle(candles: ClosedCandle[], nowMs: number): ClosedCandle | null { return candles.filter((candle) => candle.closeTimeMs <= nowMs && candle.closeTimeMs > candle.openTimeMs).sort((a, b) => b.closeTimeMs - a.closeTimeMs)[0] ?? null; }
export function decisionRecord(strategyId: string, pairId: string, candle: ClosedCandle, action: DecisionRecord['action'], reasons: string[], createdAtMs: number): DecisionRecord { return { idempotencyKey: `${strategyId}:${pairId}:${candle.closeTimeMs}`, strategyId, pairId, candleCloseTimeMs: candle.closeTimeMs, action, reasons: [...reasons], createdAtMs }; }
