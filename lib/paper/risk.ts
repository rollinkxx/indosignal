import Decimal from 'decimal.js';
import type { DecimalInput } from './types';

const D = (value: DecimalInput) => new Decimal(value);
export type RiskConfig = { maxRiskFraction: DecimalInput; atrMultiple: DecimalInput; maxConcurrentPositions: number; maxDailyLossFraction: DecimalInput; maxCorrelation: DecimalInput };
export type RiskState = { equity: DecimalInput; dailyPnl: DecimalInput; concurrentPositions: number; pairCorrelations: Record<string, DecimalInput> };

export function stopPrice(side: 'buy' | 'sell', entry: DecimalInput, atr: DecimalInput, multiple: DecimalInput): string { const distance = D(atr).mul(D(multiple)); return (side === 'buy' ? D(entry).sub(distance) : D(entry).add(distance)).toFixed(); }
export function positionSizeForRisk(equity: DecimalInput, entry: DecimalInput, stop: DecimalInput, riskFraction: DecimalInput): string { const riskBudget = D(equity).mul(D(riskFraction)); const distance = D(entry).sub(D(stop)).abs(); if (distance.lte(0)) throw new Error('Jarak entry-stop harus positif.'); return riskBudget.div(distance).toFixed(); }
export function assessRisk(config: RiskConfig, state: RiskState, pairId: string): { allowed: boolean; reasons: string[] } { const reasons: string[] = []; if (state.concurrentPositions >= config.maxConcurrentPositions) reasons.push('max_concurrent_positions'); if (D(state.dailyPnl).lte(D(state.equity).mul(D(config.maxDailyLossFraction)).neg())) reasons.push('daily_loss_circuit_breaker'); const correlation = state.pairCorrelations[pairId]; if (correlation !== undefined && D(correlation).gt(D(config.maxCorrelation))) reasons.push('correlation_cap'); return { allowed: reasons.length === 0, reasons }; }
export function riskBudget(equity: DecimalInput, maxRiskFraction: DecimalInput): string { return D(equity).mul(D(maxRiskFraction)).toFixed(); }
