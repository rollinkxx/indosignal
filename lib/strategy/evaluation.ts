import { adx, atr, type IndicatorCandle } from './indicators';
import type { ClosedCandle } from '../paper/types';

const asIndicator = (candle: ClosedCandle): IndicatorCandle => ({
  high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume),
});

function classify(adxValue: number | undefined, atrValue: number | undefined, close: number | undefined): 'trend' | 'range' | 'volatile' {
  if (adxValue === undefined || atrValue === undefined || !close || !Number.isFinite(close)) return 'range';
  if (atrValue / close >= 0.05) return 'volatile';
  return adxValue >= 20 ? 'trend' : 'range';
}

export function inferRegimeSeries(values: IndicatorCandle[]): Array<'trend' | 'range' | 'volatile'> {
  const adxValues = adx(values);
  const atrValues = atr(values);
  return values.map((candle, index) => classify(adxValues[index], atrValues[index], candle.close));
}

export function inferRegime(candles: ClosedCandle[]): 'trend' | 'range' | 'volatile' {
  const values = candles.map(asIndicator);
  return inferRegimeSeries(values).at(-1) ?? 'range';
}

export function regimeForStrategy(candles: ClosedCandle[]) {
  return inferRegime(candles);
}
