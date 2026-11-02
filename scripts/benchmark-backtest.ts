import { performance } from 'node:perf_hooks';
import { runBacktest } from '../lib/strategy/backtest';
import { getStrategy } from '../lib/strategy/registry';
import type { ClosedCandle, FeeConfig } from '../lib/paper/types';

const count = 8_760;
const start = 1_704_067_200_000;
const candles: ClosedCandle[] = Array.from({ length: count }, (_, index) => {
  const close = 100_000_000 + index * 2_000 + Math.sin(index / 25) * 1_500_000;
  return { pairId: 'btcidr', timeframe: '60', openTimeMs: start + index * 3_600_000, closeTimeMs: start + (index + 1) * 3_600_000,
    open: String(close), high: String(close + 300_000), low: String(close - 300_000), close: String(close + Math.sin(index) * 100_000), volume: String(1_000 + index % 500), source: 'history_v2' };
});
const strategy = getStrategy('trend-following');
if (!strategy) throw new Error('benchmark strategy unavailable');
const fee: FeeConfig = { makerRate: '0.001', takerRate: '0.001', taxRate: '0', sourceUrl: 'benchmark-only', effectiveFrom: '2026-01-01T00:00:00.000Z' };
const runs = [];
for (let iteration = 0; iteration < 5; iteration += 1) {
  if (global.gc) global.gc();
  const before = process.memoryUsage();
  const startTime = performance.now();
  const result = runBacktest(candles, strategy, { initialEquity: '10000000', fee, riskFraction: '0.01', slippageBps: 10, spreadBps: 20 });
  const elapsedMs = performance.now() - startTime;
  const after = process.memoryUsage();
  runs.push({ iteration: iteration + 1, elapsedMs: Number(elapsedMs.toFixed(2)), heapDeltaBytes: after.heapUsed - before.heapUsed, rssBytes: after.rss, trades: result.trades.length, equity: result.equity });
}
console.log(JSON.stringify({ benchmark: 'synthetic-only; never production market data', candles: count, timeframe: '1h', days: 365, strategy: strategy.slug, runs }, null, 2));
