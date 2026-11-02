import type { ClosedTrade, DecimalInput } from './types';

const num = (value: DecimalInput) => Number(value);
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

export function performanceMetrics(trades: ClosedTrade[], startingEquity?: DecimalInput) {
  const pnl = trades.map((trade) => num(trade.pnlQuote));
  const r = trades.map((trade) => num(trade.pnlR));
  const wins = pnl.filter((value) => value > 0).length;
  const losses = pnl.filter((value) => value < 0).length;
  const grossWin = pnl.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(pnl.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const inferredStartingEquity = trades.length ? num(trades[0].equityAfter) - pnl[0] : 0;
  const initialEquity = startingEquity === undefined ? inferredStartingEquity : num(startingEquity);
  let peak = initialEquity;
  let maxDrawdown = 0;
  let previousEquity = initialEquity;
  const returns: number[] = [];
  for (const trade of trades) {
    const equity = num(trade.equityAfter);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    peak = Math.max(peak, equity);
    if (previousEquity > 0) returns.push((equity - previousEquity) / previousEquity);
    previousEquity = equity;
  }
  const downside = returns.filter((value) => value < 0);
  const deviation = std(returns);
  const downsideDeviation = std(downside);
  const sharpe = deviation ? mean(returns) / deviation : 0;
  const sortino = downsideDeviation ? mean(returns) / downsideDeviation : 0;

  return {
    sampleCount: trades.length,
    wins,
    losses,
    winRate: trades.length ? wins / trades.length : 0,
    wilson95: wilsonInterval(wins, trades.length),
    warning: trades.length < 30 ? 'Sampel di bawah 30 trade; interval dan metrik belum stabil.' : undefined,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancyR: mean(r),
    averageWin: wins ? grossWin / wins : 0,
    averageLoss: losses ? -grossLoss / losses : 0,
    maxDrawdown,
    sharpe,
    sortino,
    riskAdjustedReturnBasis: 'per_closed_trade_unannualized' as const,
    equityCurve: [initialEquity, ...trades.map((trade) => num(trade.equityAfter))],
  };
}
