import { describe, expect, it } from 'vitest';
import { performanceMetrics } from '../lib/paper/metrics';
import type { ClosedCandle, FeeConfig } from '../lib/paper/types';
import type { StrategyDefinition } from '../lib/strategy/registry';
import { runBacktest } from '../lib/strategy/backtest';

const start = 1_800_000_000_000;
const fee: FeeConfig = {
  makerRate: '0.001',
  takerRate: '0.001',
  taxRate: '0',
  sourceUrl: 'https://example.invalid/fees',
  effectiveFrom: '2026-11-02T00:00:00.000Z',
};

function candles(count = 20): ClosedCandle[] {
  return Array.from({ length: count }, (_, index) => ({
    pairId: 'btcidr',
    timeframe: '60',
    openTimeMs: start + index * 3_600_000,
    closeTimeMs: start + (index + 1) * 3_600_000,
    open: index === 17 ? '110' : '100',
    high: index === 17 ? '112' : '102',
    low: index === 17 ? '108' : '98',
    close: index === 17 ? '110' : '100',
    volume: '1',
    source: 'history_v2',
  }));
}

function scriptedStrategy(actionAtLength: (length: number) => 'buy' | 'sell' | 'hold'): StrategyDefinition {
  return {
    slug: 'scripted-test',
    name: 'Scripted test strategy',
    description: 'Deterministic strategy for unit tests.',
    evaluate: ({ candles: history }) => {
      const action = actionAtLength(history.length);
      return { action, reason: ['test'], stopAtr: action === 'buy' ? 2 : undefined };
    },
  };
}

describe('historical backtest', () => {
  it('sizes a long spot position to the risk budget and fills only after a closed-candle signal', () => {
    const result = runBacktest(candles(), scriptedStrategy((length) => length === 15 ? 'buy' : length === 17 ? 'sell' : 'hold'), {
      initialEquity: '10000',
      fee,
      riskFraction: '0.01',
    });

    expect(result.lookAheadSafe).toBe(true);
    expect(result.trades).toHaveLength(1);
    expect(Number(result.trades[0].pnlQuote)).toBeGreaterThan(0);
    expect(Number(result.trades[0].pnlR)).toBeGreaterThan(0);
    expect(Number(result.equity)).toBeGreaterThan(10000);
    expect(result.trades[0].closedAtMs).toBe(candles()[17].closeTimeMs);
  });

  it('does not open a short position from a sell signal while flat', () => {
    const result = runBacktest(candles(), scriptedStrategy(() => 'sell'), {
      initialEquity: '10000',
      fee,
    });
    expect(result.trades).toHaveLength(0);
    expect(result.equity).toBe('10000');
  });

  it('honors the ATR stop on the entry candle and bounds planned loss including fees', () => {
    const data = candles();
    data[15] = { ...data[15], low: '90' };
    const result = runBacktest(data, scriptedStrategy((length) => length === 15 ? 'buy' : 'hold'), {
      initialEquity: '10000',
      fee,
      riskFraction: '0.01',
    });

    expect(result.trades).toHaveLength(1);
    expect(Number(result.trades[0].pnlQuote)).toBeLessThan(0);
    expect(Math.abs(Number(result.trades[0].pnlQuote))).toBeLessThanOrEqual(100.000001);
  });

  it('calculates drawdown from starting equity and exposes an initial equity point', () => {
    const metrics = performanceMetrics([
      { pnlQuote: '-100', pnlR: '-1', equityAfter: '9900', closedAtMs: start },
    ], '10000');
    expect(metrics.maxDrawdown).toBeCloseTo(0.01);
    expect(metrics.equityCurve).toEqual([10000, 9900]);
    expect(metrics.riskAdjustedReturnBasis).toBe('per_closed_trade_unannualized');
  });

  it('uses marked equity for open-position drawdown and serializes safe ratios', () => {
    const metrics = performanceMetrics([], '10000', [
      { timeMs: start, value: '10000' },
      { timeMs: start + 3_600_000, value: '9000' },
      { timeMs: start + 7_200_000, value: '11000' },
    ]);
    expect(metrics.maxDrawdown).toBeCloseTo(0.1);
    expect(metrics.equityCurve).toEqual([10000, 9000, 11000]);
    expect(metrics.profitFactor).toBe(0);
    expect(JSON.stringify(metrics)).not.toContain('Infinity');
  });

  it('captures drawdown inside a trade even when closed-trade equity recovers', () => {
    const metrics = performanceMetrics([
      { pnlQuote: '100', pnlR: '1', equityAfter: '10100', closedAtMs: start + 7_200_000 },
    ], '10000', [
      { timeMs: start, value: '10000' },
      { timeMs: start + 3_600_000, value: '7000' },
      { timeMs: start + 7_200_000, value: '10100' },
    ]);
    expect(metrics.maxDrawdown).toBeCloseTo(0.3);
  });

  it('reports actual position exposure fraction from entry and close timestamps', () => {
    const metrics = performanceMetrics([{ pnlQuote: '10', pnlR: '1', equityAfter: '10010', openedAtMs: start, closedAtMs: start + 3_600_000 }], '10000', [
      { timeMs: start, value: '10000' }, { timeMs: start + 7_200_000, value: '10010' },
    ]);
    expect(metrics.exposureTimeFraction).toBeCloseTo(0.5);
  });

  it('applies stop ATR sensitivity and rejects non-finite cost inputs', () => {
    const data = candles();
    data[16] = { ...data[16], low: '93' };
    const strategy = scriptedStrategy((length) => length === 15 ? 'buy' : 'hold');
    const tight = runBacktest(data, strategy, { initialEquity: '10000', fee, stopAtrMultiplier: 1.5 });
    const wide = runBacktest(data, strategy, { initialEquity: '10000', fee, stopAtrMultiplier: 2.5 });
    expect(Number(tight.equity)).toBeLessThan(Number(wide.equity));
    expect(() => runBacktest(data, strategy, { initialEquity: '10000', fee, slippageBps: Number.NaN })).toThrow(/finite/);
  });
});
