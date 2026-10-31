import { describe, expect, it } from 'vitest';
import { activationGate, getStrategy } from '../lib/strategy/registry';
import { walkForwardSplits } from '../lib/strategy/backtest';

describe('strategy registry', () => {
  it('menahan strategi sampai semua evidence tersedia', () => { const result = activationGate({ backtestComplete: true, outOfSampleComplete: true, sensitivityChecked: true, forwardTestDays: 13, maxDrawdownFraction: 0.1, maxAllowedDrawdownFraction: 0.2 }); expect(result.active).toBe(false); expect(result.reasons).toContain('forward_test_14_days_required'); });
  it('mendaftarkan strategi yang tidak aktif secara default', () => { expect(getStrategy('trend-following')?.slug).toBe('trend-following'); expect(getStrategy('mean-reversion')?.description).toContain('range'); });
  it('memisahkan train, validation, dan OOS secara temporal', () => { const splits = walkForwardSplits([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); expect(splits.train).toEqual([1, 2, 3, 4, 5, 6]); expect(splits.validation).toEqual([7, 8]); expect(splits.outOfSample).toEqual([9, 10]); });
});
