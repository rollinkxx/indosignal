export type IndicatorCandle = { high: number; low: number; close: number; volume: number };
export type DonchianChannel = { upper: number; lower: number; middle: number };

function validatePeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) throw new RangeError('period must be a positive integer');
}

export const sma = (values: number[], period: number): Array<number | undefined> => {
  validatePeriod(period);
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
};

export const ema = (values: number[], period: number): Array<number | undefined> => {
  validatePeriod(period);
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  const alpha = 2 / (period + 1);
  let previous: number | undefined;
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) continue;
    if (previous === undefined) {
      previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    } else {
      previous = alpha * values[i] + (1 - alpha) * previous;
    }
    out[i] = previous;
  }
  return out;
};

export const stddev = (values: number[], period: number): Array<number | undefined> => {
  validatePeriod(period);
  return values.map((_, i) => {
    if (i < period - 1) return undefined;
    const window = values.slice(i - period + 1, i + 1);
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
  });
};

/** Wilder RSI. The first value is seeded from the first `period` close-to-close changes. */
export const rsi = (values: number[], period = 14): Array<number | undefined> => {
  validatePeriod(period);
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  const value = () => averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - 100 / (1 + averageGain / averageLoss);
  out[period] = value();
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = value();
  }
  return out;
};

function trueRange(candles: IndicatorCandle[]): Array<number | undefined> {
  return candles.map((candle, i) => i === 0
    ? candle.high - candle.low
    : Math.max(candle.high - candle.low, Math.abs(candle.high - candles[i - 1].close), Math.abs(candle.low - candles[i - 1].close)));
}

/** Wilder ATR, seeded with the arithmetic mean of the first `period` true ranges. */
export const atr = (candles: IndicatorCandle[], period = 14): Array<number | undefined> => {
  validatePeriod(period);
  const ranges = trueRange(candles);
  const out: Array<number | undefined> = new Array(candles.length).fill(undefined);
  if (candles.length < period) return out;
  let smoothed = ranges.slice(0, period).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  out[period - 1] = smoothed / period;
  for (let i = period; i < candles.length; i += 1) {
    smoothed = smoothed - smoothed / period + (ranges[i] ?? 0);
    out[i] = smoothed / period;
  }
  return out;
};

/**
 * Donchian channel available at index i is calculated only from the `period` candles
 * immediately before i. The trigger candle is deliberately excluded.
 */
export const donchian = (candles: IndicatorCandle[], period: number): Array<DonchianChannel | undefined> => {
  validatePeriod(period);
  const out: Array<DonchianChannel | undefined> = new Array(candles.length).fill(undefined);
  let maxQueue: number[] = [];
  let minQueue: number[] = [];
  // Monotonic queues store indices of the prior-candle window.
  for (let i = 0; i < candles.length; i += 1) {
    const addIndex = i - 1;
    if (addIndex >= 0) {
      while (maxQueue.length && candles[maxQueue.at(-1)!].high <= candles[addIndex].high) maxQueue.pop();
      maxQueue.push(addIndex);
      while (minQueue.length && candles[minQueue.at(-1)!].low >= candles[addIndex].low) minQueue.pop();
      minQueue.push(addIndex);
    }
    const firstAllowed = i - period;
    while (maxQueue.length && maxQueue[0] < firstAllowed) maxQueue.shift();
    while (minQueue.length && minQueue[0] < firstAllowed) minQueue.shift();
    if (i >= period && maxQueue.length && minQueue.length) {
      const upper = candles[maxQueue[0]].high;
      const lower = candles[minQueue[0]].low;
      out[i] = { upper, lower, middle: (upper + lower) / 2 };
    }
  }
  return out;
};

export const bollinger = (values: number[], period = 20, multiple = 2) => values.map((_, i) => {
  if (i < period - 1) return undefined;
  const window = values.slice(i - period + 1, i + 1);
  const middle = window.reduce((sum, value) => sum + value, 0) / period;
  const deviation = Math.sqrt(window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period);
  return { upper: middle + multiple * deviation, middle, lower: middle - multiple * deviation };
});

/** Wilder's Directional Movement System. First ADX appears after 2*period-1 candles. */
export const adx = (candles: IndicatorCandle[], period = 14): Array<number | undefined> => {
  validatePeriod(period);
  const out: Array<number | undefined> = new Array(candles.length).fill(undefined);
  if (candles.length <= period * 2 - 1) return out;

  const tr = new Array<number>(candles.length).fill(0);
  const plusDm = new Array<number>(candles.length).fill(0);
  const minusDm = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i += 1) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    tr[i] = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  let smoothTr = tr.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  let smoothPlus = plusDm.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  let smoothMinus = minusDm.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
  const dx: Array<number | undefined> = new Array(candles.length).fill(undefined);
  const computeDx = (index: number) => {
    if (smoothTr <= 0) { dx[index] = 0; return; }
    const plusDi = 100 * smoothPlus / smoothTr;
    const minusDi = 100 * smoothMinus / smoothTr;
    const denominator = plusDi + minusDi;
    dx[index] = denominator === 0 ? 0 : 100 * Math.abs(plusDi - minusDi) / denominator;
  };
  computeDx(period);
  for (let i = period + 1; i < candles.length; i += 1) {
    smoothTr = smoothTr - smoothTr / period + tr[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];
    computeDx(i);
  }

  const firstAdx = period * 2 - 1;
  let adxValue = dx.slice(period, firstAdx + 1).reduce<number>((sum, value) => sum + (value ?? 0), 0) / period;
  out[firstAdx] = adxValue;
  for (let i = firstAdx + 1; i < candles.length; i += 1) {
    adxValue = (adxValue * (period - 1) + (dx[i] ?? 0)) / period;
    out[i] = adxValue;
  }
  return out;
};
