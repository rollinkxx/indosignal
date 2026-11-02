import { describe, expect, it } from 'vitest';
import { adx, atr, donchian, rsi, type IndicatorCandle } from '../lib/strategy/indicators';

const candles = (rows: Array<[number, number, number, number]>): IndicatorCandle[] => rows.map(([high, low, close, volume]) => ({ high, low, close, volume }));

describe('Wilder indicators and no-look-ahead channels', () => {
  it('seeds RSI with the first period of changes, then applies Wilder smoothing', () => {
    const values = [10, 11, 10, 12, 11, 13];
    const result = rsi(values, 3);
    expect(result.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    // Seed: avg gain=1, avg loss=1/3 => RSI=75. Subsequent values use Wilder recursion.
    expect(result[3]).toBeCloseTo(75, 10);
    expect(result[4]).toBeCloseTo(100 - 100 / (1 + (2 / 3) / (5 / 9)), 10);
    expect(result[5]).toBeCloseTo(75, 10);
  });

  it('uses Wilder recursive smoothing for ATR', () => {
    const input = candles([
      [11, 9, 10, 1],
      [13, 10, 12, 1],
      [14, 11, 13, 1],
      [15, 12, 14, 1],
    ]);
    const result = atr(input, 3);
    expect(result[1]).toBeUndefined();
    // TR values are 2, 3, 3; seed ATR=8/3. Next TR=3 and Wilder ATR=(2*8/3+3)/3=25/9.
    expect(result[2]).toBeCloseTo(8 / 3, 10);
    expect(result[3]).toBeCloseTo(25 / 9, 10);
  });

  it('computes canonical directional movement and ADX warm-up', () => {
    const input = candles([
      [10, 8, 9, 1], [12, 10, 11, 1], [14, 12, 13, 1], [16, 14, 15, 1], [18, 16, 17, 1],
    ]);
    const result = adx(input, 2);
    expect(result.slice(0, 2)).toEqual([undefined, undefined]);
    expect(result[2]).toBeUndefined();
    expect(result[3]).toBeCloseTo(100, 10);
    expect(result[4]).toBeCloseTo(100, 10);
  });

  it('builds Donchian from prior candle highs/lows, excluding the triggering candle', () => {
    const input = candles([
      [10, 5, 8, 1], [12, 4, 11, 1], [11, 6, 10, 1], [100, 1, 99, 10],
    ]);
    const result = donchian(input, 3);
    expect(result.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(result[3]).toEqual({ upper: 12, lower: 4, middle: 8 });
  });

  it('rejects invalid periods rather than silently returning misleading values', () => {
    expect(() => adx([], 0)).toThrow(RangeError);
    expect(() => rsi([1, 2], 1.5)).toThrow(RangeError);
  });
});
