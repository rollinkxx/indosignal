import { describe, expect, it } from 'vitest';
import { activationGate, evaluateStrategySeries, getStrategy } from '../lib/strategy/registry';
import { walkForwardSplits } from '../lib/strategy/backtest';
import { closedCandlesThrough, inferRegimeSeries } from '../lib/strategy/evaluation';
import type { IndicatorCandle } from '../lib/strategy/indicators';
import type { ClosedCandle } from '../lib/paper/types';

describe('strategy registry', () => {
  it('menahan strategi sampai semua evidence tersedia', () => { const result = activationGate({ backtestComplete: true, outOfSampleComplete: true, sensitivityChecked: true, forwardTestDays: 13, maxDrawdownFraction: 0.1, maxAllowedDrawdownFraction: 0.2 }); expect(result.active).toBe(false); expect(result.reasons).toContain('forward_test_14_days_required'); });
  it('mendaftarkan strategi yang tidak aktif secara default', () => { expect(getStrategy('trend-following')?.slug).toBe('trend-following'); expect(getStrategy('mean-reversion')?.description).toContain('range'); });
  it('memisahkan train, validation, dan OOS secara temporal', () => { const splits = walkForwardSplits([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); expect(splits.train).toEqual([1, 2, 3, 4, 5, 6]); expect(splits.validation).toEqual([7, 8]); expect(splits.outOfSample).toEqual([9, 10]); });
  it('sinyal precomputed sama dengan golden causal prefix dan tidak memakai candle masa depan', () => {
    const candles: IndicatorCandle[] = Array.from({ length: 240 }, (_, index) => {
      const close = 100 + index * 0.12 + Math.sin(index / 4) * 1.8;
      return { high: close + 1.5, low: close - 1.5, close, volume: 100 + (index % 17) };
    });
    const alteredFuture = candles.map((candle, index) => index < 180 ? candle : { high: 20_000 + index, low: 19_000 + index, close: 19_500 + index, volume: 1_000_000 });
    for (const slug of ['trend-following', 'breakout-volume', 'mean-reversion']) {
      const strategy = getStrategy(slug)!;
      const signals = evaluateStrategySeries(strategy, candles);
      const changed = evaluateStrategySeries(strategy, alteredFuture);
      expect(changed.slice(0, 180)).toEqual(signals.slice(0, 180));
      for (let index = 0; index < candles.length; index += 1) {
        const prefix = candles.slice(0, index + 1);
        expect(signals[index]).toEqual(strategy.evaluate({ candles: prefix, regime: inferRegimeSeries(prefix).at(-1) ?? 'range' }));
      }
    }
  });
  it('membatasi regime pada candle yang sudah ditutup saat keputusan dibuat', () => {
    const closed: ClosedCandle[] = Array.from({ length: 2 }, (_, index) => ({
      pairId: 'btcidr', timeframe: '60', openTimeMs: index * 3_600_000, closeTimeMs: (index + 1) * 3_600_000,
      open: '100', high: '105', low: '95', close: '101', volume: '10', source: 'history_v2',
    }));
    const future: ClosedCandle = {
      pairId: 'btcidr', timeframe: '60', openTimeMs: 7_200_000, closeTimeMs: 10_800_000,
      open: '100', high: '100000', low: '1', close: '50000', volume: '1000000', source: 'history_v2',
    };
    expect(closedCandlesThrough([...closed, future], closed[1].closeTimeMs)).toEqual(closed);
  });
  it('membutuhkan kuantitatif OOS dan sensitivitas untuk melewati activation gate', () => {
    const gate = activationGate({ backtestComplete: true, outOfSampleComplete: true, sensitivityChecked: true, sensitivityScenarioCount: 8, sensitivityMetricsValid: true, sensitivityWorstDrawdownFraction: 0.1, outOfSampleTradeCount: 40, outOfSampleExpectancyR: 0.2, outOfSampleProfitFactor: 1.2, forwardTestDays: 14, forwardTestCoverageValid: true, taxConfigVerified: true, maxDrawdownFraction: 0.1, maxAllowedDrawdownFraction: 0.2 });
    expect(gate.active).toBe(true);
  });
});
