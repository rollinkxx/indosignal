import Decimal from 'decimal.js';
import type { ClosedCandle, ClosedTrade, FeeConfig } from '../paper/types';
import { atr, type IndicatorCandle } from './indicators';
import type { StrategyDefinition } from './registry';
import { inferRegime } from './evaluation';

const D = (value: string | number) => new Decimal(value);
const toIndicator = (candle: ClosedCandle): IndicatorCandle => ({
  high: Number(candle.high),
  low: Number(candle.low),
  close: Number(candle.close),
  volume: Number(candle.volume),
});

type Regime = 'trend' | 'range' | 'volatile';
export type BacktestOptions = {
  initialEquity: string;
  fee: FeeConfig;
  /** Retained for API compatibility; historical regimes are inferred per candle. */
  regime?: Regime;
  riskFraction?: string;
  fromIndex?: number;
  endIndexExclusive?: number;
};
export type BacktestResult = {
  trades: ClosedTrade[];
  equity: string;
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
};

/**
 * Historical spot simulation: buy opens a long position, sell closes it (never shorts).
 * Signals are evaluated at a closed candle and filled no earlier than the next candle open.
 * Risk per entry defaults to 1% of available equity; a 2x ATR stop is used when a strategy
 * does not provide its own stopAtr. Stops fill at the stop, or at the next open after a gap.
 */
export function runBacktest(candles: ClosedCandle[], strategy: StrategyDefinition, options: BacktestOptions): BacktestResult {
  const initialEquity = D(options.initialEquity);
  const riskFraction = D(options.riskFraction ?? '0.01');
  const takerRate = D(options.fee.takerRate).add(D(options.fee.taxRate));
  const trades: ClosedTrade[] = [];
  let cash = initialEquity;
  let position: Position | undefined;
  const fromIndex = Math.max(0, options.fromIndex ?? 0);
  const endIndexExclusive = Math.min(candles.length, options.endIndexExclusive ?? candles.length);

  const closePosition = (exitPrice: Decimal, closedAtMs: number) => {
    if (!position) return;
    const exitValue = position.quantity.mul(exitPrice);
    const exitFee = exitValue.mul(takerRate);
    cash = cash.add(exitValue.sub(exitFee));
    const entryCost = position.quantity.mul(position.entryPrice).add(position.entryFee);
    const pnl = exitValue.sub(exitFee).sub(entryCost);
    trades.push({
      pnlQuote: pnl.toFixed(),
      pnlR: position.riskBudget.gt(0) ? pnl.div(position.riskBudget).toFixed() : '0',
      equityAfter: cash.toFixed(),
      closedAtMs,
    });
    position = undefined;
  };

  // The final candle is reserved as the last possible fill/mark-to-market candle.
  for (let index = fromIndex; index < endIndexExclusive - 1; index += 1) {
    const candle = candles[index];
    const next = candles[index + 1];
    const history = candles.slice(0, index + 1);
    const indicators = history.map(toIndicator);
    const signal = strategy.evaluate({ candles: indicators, regime: inferRegime(history) });
    const hadPositionAtOpen = Boolean(position);

    if (position) {
      if (Number(next.open) <= position.stopPrice.toNumber()) {
        closePosition(D(next.open), next.closeTimeMs);
      } else if (Number(next.low) <= position.stopPrice.toNumber()) {
        closePosition(position.stopPrice, next.closeTimeMs);
      } else if (signal.action === 'sell') {
        closePosition(D(next.open), next.closeTimeMs);
      }
    }

    if (!hadPositionAtOpen && !position && signal.action === 'buy' && cash.gt(0)) {
      const atrValue = atr(indicators).at(-1);
      const entryPrice = D(next.open);
      const stopMultiple = D(signal.stopAtr ?? 2);
      if (atrValue !== undefined && atrValue > 0 && entryPrice.gt(0) && riskFraction.gt(0)) {
        const stopPrice = entryPrice.sub(D(atrValue).mul(stopMultiple));
        if (stopPrice.gt(0) && stopPrice.lt(entryPrice)) {
          const riskBudget = cash.mul(riskFraction);
          const riskPerUnitIncludingFees = entryPrice.sub(stopPrice).add(entryPrice.add(stopPrice).mul(takerRate));
          if (riskPerUnitIncludingFees.lte(0)) continue;
          const riskSizedQuantity = riskBudget.div(riskPerUnitIncludingFees);
          const affordableQuantity = cash.div(entryPrice.mul(D(1).add(takerRate)));
          const quantity = Decimal.min(riskSizedQuantity, affordableQuantity);
          if (quantity.gt(0)) {
            const entryValue = quantity.mul(entryPrice);
            const entryFee = entryValue.mul(takerRate);
            position = { quantity, entryPrice, entryFee, stopPrice, riskBudget };
            cash = cash.sub(entryValue).sub(entryFee);
            // If the stop is crossed in the entry candle, execute it within that candle.
            if (Number(next.low) <= stopPrice.toNumber()) {
              const exitPrice = Number(next.open) <= stopPrice.toNumber() ? D(next.open) : stopPrice;
              closePosition(exitPrice, next.closeTimeMs);
            }
          }
        }
      }
    }
  }

  if (position && endIndexExclusive > 0) {
    const finalCandle = candles[endIndexExclusive - 1];
    closePosition(D(finalCandle.close), finalCandle.closeTimeMs);
  }

  return {
    trades,
    equity: cash.toFixed(),
    startMs: candles[fromIndex]?.openTimeMs,
    endMs: candles[Math.max(fromIndex, endIndexExclusive - 1)]?.closeTimeMs,
    lookAheadSafe: true,
  };
}

export function walkForwardSplits<T>(items: T[], trainFraction = 0.6, validationFraction = 0.2) {
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
