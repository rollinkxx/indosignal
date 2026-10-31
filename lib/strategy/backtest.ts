import Decimal from 'decimal.js';
import type { ClosedCandle, ClosedTrade, FeeConfig } from '../paper/types';
import type { StrategyDefinition } from './registry';

const D = (v: string | number) => new Decimal(v);
export type BacktestOptions = { initialEquity: string; fee: FeeConfig; regime: 'trend' | 'range' | 'volatile' };
export type BacktestResult = { trades: ClosedTrade[]; equity: string; startMs?: number; endMs?: number; lookAheadSafe: true };

export function runBacktest(candles: ClosedCandle[], strategy: StrategyDefinition, options: BacktestOptions): BacktestResult {
  let equity = D(options.initialEquity); const trades: ClosedTrade[] = [];
  for (let index = 0; index < candles.length - 1; index += 1) {
    const history = candles.slice(0, index + 1);
    const signal = strategy.evaluate({ regime: options.regime, candles: history.map((candle) => ({ high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume) })) });
    if (signal.action === 'hold') continue;
    const entry = D(candles[index + 1].open); const exit = D(candles[index + 1].close); const direction = signal.action === 'buy' ? 1 : -1; const gross = exit.sub(entry).mul(direction); const fee = entry.add(exit).mul(D(options.fee.takerRate)); const pnl = gross.sub(fee); const previousEquity = equity; equity = equity.add(pnl); trades.push({ pnlQuote: pnl.toFixed(), pnlR: previousEquity.gt(0) ? pnl.div(previousEquity.mul('0.01')).toFixed() : '0', equityAfter: equity.toFixed(), closedAtMs: candles[index + 1].closeTimeMs });
  }
  return { trades, equity: equity.toFixed(), startMs: candles[0]?.openTimeMs, endMs: candles.at(-1)?.closeTimeMs, lookAheadSafe: true };
}

export function walkForwardSplits<T>(items: T[], trainFraction = 0.6, validationFraction = 0.2) { const trainEnd = Math.floor(items.length * trainFraction); const validationEnd = trainEnd + Math.floor(items.length * validationFraction); return { train: items.slice(0, trainEnd), validation: items.slice(trainEnd, validationEnd), outOfSample: items.slice(validationEnd) }; }
