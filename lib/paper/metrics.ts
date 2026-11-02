import type { ClosedTrade, DecimalInput } from './types';

type EquitySample = { timeMs: number; value: DecimalInput };
const num = (value: DecimalInput) => Number(value);
const finite = (value: number) => Number.isFinite(value) ? value : 0;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
};

export function wilsonInterval(wins: number, total: number, z = 1.96): [number, number] {
  if (!total) return [0, 0];
  const p = wins / total;
  const denominator = 1 + z ** 2 / total;
  const center = (p + z ** 2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * total)) / total) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

/** Ratios from sampled equity are intentionally unannualized; input cadence must be documented. */
export function performanceMetrics(trades: ClosedTrade[], startingEquity?: DecimalInput, markedEquity?: EquitySample[]) {
  const pnl = trades.map((trade) => finite(num(trade.pnlQuote)));
  const r = trades.map((trade) => finite(num(trade.pnlR)));
  const wins = pnl.filter((value) => value > 0).length;
  const losses = pnl.filter((value) => value < 0).length;
  const grossWin = pnl.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(pnl.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const inferredStartingEquity = trades.length ? finite(num(trades[0].equityAfter) - pnl[0]) : 0;
  const initialEquity = startingEquity === undefined ? inferredStartingEquity : finite(num(startingEquity));
  const ordered = markedEquity?.length
    ? [...markedEquity].sort((a, b) => a.timeMs - b.timeMs).map((sample) => ({ timeMs: sample.timeMs, value: finite(num(sample.value)) }))
    : trades.map((trade) => ({ timeMs: trade.closedAtMs, value: finite(num(trade.equityAfter)) }));
  const equityValues = markedEquity?.length ? ordered.map((sample) => sample.value) : [initialEquity, ...ordered.map((sample) => sample.value)];
  let peak = initialEquity;
  let maxDrawdown = 0;
  for (const equity of equityValues) {
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, Math.max(0, (peak - equity) / peak));
    peak = Math.max(peak, equity);
  }
  const returns: number[] = [];
  for (let i = 1; i < equityValues.length; i += 1) {
    const prior = equityValues[i - 1];
    if (prior > 0) returns.push((equityValues[i] - prior) / prior);
  }
  const downside = returns.filter((value) => value < 0);
  const deviation = std(returns);
  const downsideDeviation = Math.sqrt(downside.length ? downside.reduce((sum, value) => sum + value ** 2, 0) / returns.length : 0);
  const firstTime = ordered[0]?.timeMs;
  const lastTime = ordered.at(-1)?.timeMs;
  const durationMs = firstTime !== undefined && lastTime !== undefined ? Math.max(0, lastTime - firstTime) : 0;
  const exposureMs = trades.reduce((sum, trade) => sum + (trade.openedAtMs === undefined ? 0 : Math.max(0, trade.closedAtMs - trade.openedAtMs)), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0;
  const warnings: string[] = [];
  if (trades.length < 30) warnings.push('Sampel di bawah 30 trade; inferensi trade belum stabil.');
  if (returns.length < 30) warnings.push('Kurang dari 30 return equity; Sharpe/Sortino tidak memadai.');
  if (profitFactor === null) warnings.push('Tidak ada trade rugi; profit factor tidak terdefinisi.');

  return {
    sampleCount: trades.length,
    wins,
    losses,
    winRate: trades.length ? wins / trades.length : 0,
    wilson95: wilsonInterval(wins, trades.length),
    warning: warnings[0],
    warnings,
    profitFactor,
    expectancyR: mean(r),
    averageWin: wins ? grossWin / wins : 0,
    averageLoss: losses ? -grossLoss / losses : 0,
    maxDrawdown: finite(maxDrawdown),
    sharpe: deviation > 0 ? finite(mean(returns) / deviation) : 0,
    sortino: downsideDeviation > 0 ? finite(mean(returns) / downsideDeviation) : 0,
    riskAdjustedReturnBasis: markedEquity?.length ? 'per_candle_unannualized' as const : 'per_closed_trade_unannualized' as const,
    exposureTimeFraction: durationMs > 0 ? Math.min(1, exposureMs / durationMs) : 0,
    equityCurve: equityValues,
  };
}
