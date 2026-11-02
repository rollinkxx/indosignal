import Decimal from 'decimal.js';
import type { ClosedCandle, ClosedTrade, FeeConfig } from '../paper/types';
import { atr, type IndicatorCandle } from './indicators';
import { evaluateStrategySeries, type StrategyDefinition } from './registry';

const D = (value: string | number) => new Decimal(value);
const toIndicator = (candle: ClosedCandle): IndicatorCandle => ({
  high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume),
});

type Regime = 'trend' | 'range' | 'volatile';
export type BacktestOptions = {
  initialEquity: string;
  fee: FeeConfig;
  /** Retained for compatibility; regimes are inferred from past candles only. */
  regime?: Regime;
  riskFraction?: string;
  fromIndex?: number;
  endIndexExclusive?: number;
  slippageBps?: number;
  spreadBps?: number;
  stopAtrMultiplier?: number;
};
export type EquityPoint = { timeMs: number; value: string };
export type BacktestResult = {
  trades: ClosedTrade[];
  equity: string;
  equityCurve: EquityPoint[];
  exposureMs: number;
  startMs?: number;
  endMs?: number;
  lookAheadSafe: true;
};

type Position = {
  quantity: Decimal;
  entryPrice: Decimal;
  entryFee: Decimal;
  stopPrice: Decimal;
  riskBudget: Decimal;
  enteredAtMs: number;
};

/**
 * Historical spot-long-only simulation. Signals from a closed candle are filled no earlier
 * than the next candle open. The current trigger candle is never used as Donchian input.
 * Equity is marked to market at each close, net of estimated liquidation spread, slippage,
 * taker fee and tax. Stop gaps fill at the next open, not at the stop price.
 */
export function runBacktest(candles: ClosedCandle[], strategy: StrategyDefinition, options: BacktestOptions): BacktestResult {
  const initialEquity = D(options.initialEquity);
  const riskFraction = D(options.riskFraction ?? '0.01');
  const feeRate = D(options.fee.takerRate).add(D(options.fee.taxRate));
  const slippageRate = D(options.slippageBps ?? 0).div(10_000);
  const spreadRate = D(options.spreadBps ?? 0).div(20_000); // half spread per side
  if (!initialEquity.isFinite() || !initialEquity.gt(0)) throw new RangeError('initialEquity must be finite and positive');
  if (!riskFraction.isFinite() || riskFraction.lt(0) || riskFraction.gt(1)) throw new RangeError('riskFraction must be finite and between 0 and 1');
  if (!feeRate.isFinite() || !slippageRate.isFinite() || !spreadRate.isFinite() || feeRate.lt(0) || feeRate.gte(1) || slippageRate.lt(0) || spreadRate.lt(0) || slippageRate.gte(1) || spreadRate.gte(1)) throw new RangeError('cost rates must be finite and non-negative');
  if (options.stopAtrMultiplier !== undefined && (!Number.isFinite(options.stopAtrMultiplier) || options.stopAtrMultiplier <= 0 || options.stopAtrMultiplier > 10)) throw new RangeError('stopAtrMultiplier must be finite and between 0 and 10');

  const trades: ClosedTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const indicatorHistory = candles.map(toIndicator);
  const signals = evaluateStrategySeries(strategy, indicatorHistory);
  const atrValues = atr(indicatorHistory);
  let cash = initialEquity;
  let position: Position | undefined;
  let exposureMs = 0;
  const fromIndex = Math.max(0, options.fromIndex ?? 0);
  const endIndexExclusive = Math.min(candles.length, options.endIndexExclusive ?? candles.length);
  const friction = slippageRate.add(spreadRate);
  const buyPrice = (price: Decimal) => price.mul(D(1).add(friction));
  const sellPrice = (price: Decimal) => price.mul(D(1).sub(friction));

  const recordEquity = (timeMs: number, markPrice?: Decimal) => {
    const marketValue = position && markPrice
      ? position.quantity.mul(sellPrice(markPrice)).mul(D(1).sub(feeRate))
      : D(0);
    equityCurve.push({ timeMs, value: cash.add(marketValue).toFixed() });
  };
  const closePosition = (rawExitPrice: Decimal, closedAtMs: number) => {
    if (!position) return;
    const executionPrice = sellPrice(rawExitPrice);
    const exitValue = position.quantity.mul(executionPrice);
    const exitFee = exitValue.mul(feeRate);
    cash = cash.add(exitValue.sub(exitFee));
    const entryCost = position.quantity.mul(position.entryPrice).add(position.entryFee);
    const pnl = exitValue.sub(exitFee).sub(entryCost);
    trades.push({
      pnlQuote: pnl.toFixed(),
      pnlR: position.riskBudget.gt(0) ? pnl.div(position.riskBudget).toFixed() : '0',
      equityAfter: cash.toFixed(),
      openedAtMs: position.enteredAtMs,
      closedAtMs,
    });
    exposureMs += Math.max(0, closedAtMs - position.enteredAtMs);
    position = undefined;
  };

  if (candles[fromIndex]) recordEquity(candles[fromIndex].openTimeMs);
  for (let index = fromIndex; index < endIndexExclusive - 1; index += 1) {
    const candle = candles[index];
    const next = candles[index + 1];
    // Keep all earlier candles strictly for warm-up; strategy implementations are causal.
    const signal = signals[index];
    const hadPositionAtOpen = Boolean(position);

    if (position) {
      const nextOpen = D(next.open);
      if (nextOpen.lte(position.stopPrice)) closePosition(nextOpen, next.closeTimeMs);
      else if (D(next.low).lte(position.stopPrice)) closePosition(position.stopPrice, next.closeTimeMs);
      else if (signal.action === 'sell') closePosition(nextOpen, next.closeTimeMs);
    }

    if (!hadPositionAtOpen && !position && signal.action === 'buy' && cash.gt(0)) {
      const atrValue = atrValues[index];
      const rawEntry = D(next.open);
      const executionEntry = buyPrice(rawEntry);
      const stopMultiple = D(options.stopAtrMultiplier ?? signal.stopAtr ?? 2);
      if (!stopMultiple.isFinite() || stopMultiple.lte(0) || stopMultiple.gt(10)) throw new RangeError('stopAtrMultiplier must be finite and between 0 and 10');
      if (atrValue !== undefined && Number.isFinite(atrValue) && atrValue > 0 && executionEntry.gt(0) && riskFraction.gt(0)) {
        const stopPrice = executionEntry.sub(D(atrValue).mul(stopMultiple));
        if (stopPrice.gt(0) && stopPrice.lt(executionEntry)) {
          const riskBudget = cash.mul(riskFraction);
          const entryUnitCost = executionEntry.mul(D(1).add(feeRate));
          const stopUnitProceeds = sellPrice(stopPrice).mul(D(1).sub(feeRate));
          const riskPerUnit = entryUnitCost.sub(stopUnitProceeds);
          if (riskPerUnit.gt(0)) {
            const riskSizedQuantity = riskBudget.div(riskPerUnit);
            const affordableQuantity = cash.div(entryUnitCost);
            const quantity = Decimal.min(riskSizedQuantity, affordableQuantity);
            if (quantity.gt(0)) {
              const entryValue = quantity.mul(executionEntry);
              const entryFee = entryValue.mul(feeRate);
              position = { quantity, entryPrice: executionEntry, entryFee, stopPrice, riskBudget, enteredAtMs: next.openTimeMs };
              cash = cash.sub(entryValue).sub(entryFee);
              // Intrabar stop ordering is conservative: a stop crossed in the entry candle exits immediately.
              if (D(next.open).lte(stopPrice)) closePosition(D(next.open), next.closeTimeMs);
              else if (D(next.low).lte(stopPrice)) closePosition(stopPrice, next.closeTimeMs);
            }
          }
        }
      }
    }
    recordEquity(next.closeTimeMs, D(next.close));
  }

  // Force-close at the final mark for comparable end equity; the point is replaced with realized cash.
  if (position && endIndexExclusive > 0) {
    const finalCandle = candles[endIndexExclusive - 1];
    closePosition(D(finalCandle.close), finalCandle.closeTimeMs);
    const lastPoint = equityCurve.at(-1);
    if (lastPoint?.timeMs === finalCandle.closeTimeMs) lastPoint.value = cash.toFixed();
  }

  return {
    trades,
    equity: cash.toFixed(),
    equityCurve,
    exposureMs,
    startMs: candles[fromIndex]?.openTimeMs,
    endMs: candles[Math.max(fromIndex, endIndexExclusive - 1)]?.closeTimeMs,
    lookAheadSafe: true,
  };
}

export function walkForwardSplits<T>(items: T[], trainFraction = 0.6, validationFraction = 0.2) {
  if (trainFraction <= 0 || validationFraction <= 0 || trainFraction + validationFraction >= 1) throw new RangeError('walk-forward fractions must be positive and leave an OOS segment');
  const trainEnd = Math.floor(items.length * trainFraction);
  const validationEnd = trainEnd + Math.floor(items.length * validationFraction);
  return {
    train: items.slice(0, trainEnd),
    validation: items.slice(trainEnd, validationEnd),
    outOfSample: items.slice(validationEnd),
    trainEnd,
    validationEnd,
  };
}
