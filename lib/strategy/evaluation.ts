import { adx, atr, type IndicatorCandle } from './indicators';
import type { StrategyDefinition } from './registry';
import type { ClosedCandle } from '../paper/types';

export function inferRegime(candles: ClosedCandle[]): 'trend' | 'range' | 'volatile' {
  const values: IndicatorCandle[] = candles.map((candle) => ({ high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume) }));
  const lastAdx = adx(values).at(-1);
  const lastAtr = atr(values).at(-1);
  const lastClose = values.at(-1)?.close;
  if (lastAdx === undefined || lastAtr === undefined || !lastClose) return 'range';
  if (lastAtr / lastClose >= 0.05) return 'volatile';
  return lastAdx >= 20 ? 'trend' : 'range';
}

export function regimeForStrategy(strategy: StrategyDefinition, candles: ClosedCandle[]) {
  const inferred = inferRegime(candles);
  if (inferred === 'volatile') return inferred;
  if (strategy.slug === 'mean-reversion') return 'range' as const;
  return inferred;
}
