import { adx, atr, bollinger, donchian, ema, rsi, sma, type IndicatorCandle, type DonchianChannel } from './indicators';
import { inferRegimeSeries } from './evaluation';

export type StrategySignal = { action: 'buy' | 'sell' | 'hold'; reason: string[]; stopAtr?: number };
export type StrategyContext = { candles: IndicatorCandle[]; regime: 'trend' | 'range' | 'volatile' };
export type StrategyDefinition = {
  slug: string;
  name: string;
  description: string;
  evaluate: (context: StrategyContext) => StrategySignal;
  evaluateSeries?: (candles: IndicatorCandle[]) => StrategySignal[];
};

const closeSeries = (candles: IndicatorCandle[]) => candles.map((candle) => candle.close);
const hold = (reason: string): StrategySignal => ({ action: 'hold', reason: [reason] });

const trendFollowing: StrategyDefinition = {
  slug: 'trend-following', name: 'Trend following EMA + ADX',
  description: 'EMA20/50/200 dengan ADX Wilder sebagai gerbang regime trend.',
  evaluate: ({ candles, regime }) => {
    const values = closeSeries(candles);
    const fast = ema(values, 20).at(-1), medium = ema(values, 50).at(-1), slow = ema(values, 200).at(-1);
    const strength = adx(candles).at(-1), volatility = atr(candles).at(-1);
    if (fast === undefined || medium === undefined || slow === undefined || strength === undefined || volatility === undefined || regime !== 'trend') return hold('indikator belum lengkap atau regime bukan trend');
    if (fast > medium && medium > slow && strength >= 20) return { action: 'buy', reason: ['EMA20 di atas EMA50 di atas EMA200', 'ADX Wilder mengonfirmasi trend'], stopAtr: 2 };
    if (fast < medium && medium < slow && strength >= 20) return { action: 'sell', reason: ['EMA20 di bawah EMA50 di bawah EMA200', 'ADX Wilder mengonfirmasi trend'], stopAtr: 2 };
    return hold('alignment EMA belum cukup');
  },
  evaluateSeries: (candles) => {
    const values = closeSeries(candles);
    const fast = ema(values, 20), medium = ema(values, 50), slow = ema(values, 200), strength = adx(candles), volatility = atr(candles);
    const regimes = inferRegimeSeries(candles);
    return candles.map((_, i) => {
      if (fast[i] === undefined || medium[i] === undefined || slow[i] === undefined || strength[i] === undefined || volatility[i] === undefined || regimes[i] !== 'trend') return hold('indikator belum lengkap atau regime bukan trend');
      if (fast[i]! > medium[i]! && medium[i]! > slow[i]! && strength[i]! >= 20) return { action: 'buy', reason: ['EMA20 di atas EMA50 di atas EMA200', 'ADX Wilder mengonfirmasi trend'], stopAtr: 2 };
      if (fast[i]! < medium[i]! && medium[i]! < slow[i]! && strength[i]! >= 20) return { action: 'sell', reason: ['EMA20 di bawah EMA50 di bawah EMA200', 'ADX Wilder mengonfirmasi trend'], stopAtr: 2 };
      return hold('alignment EMA belum cukup');
    });
  },
};

const breakout: StrategyDefinition = {
  slug: 'breakout-volume', name: 'Donchian breakout + volume',
  description: 'Breakout channel Donchian high/low candle sebelumnya, tervalidasi volume periode sebelumnya.',
  evaluate: ({ candles, regime }) => {
    const channel = donchian(candles, 20).at(-1);
    const volumes = candles.map((candle) => candle.volume);
    const averageVolume = sma(volumes.slice(0, -1), 20).at(-1);
    const close = candles.at(-1)?.close;
    if (!channel || averageVolume === undefined || close === undefined || atr(candles).at(-1) === undefined || regime !== 'trend') return hold('breakout menunggu channel/volume/regime');
    if (close > channel.upper && volumes.at(-1)! > averageVolume) return { action: 'buy', reason: ['close menembus Donchian upper sebelumnya', 'volume di atas rata-rata periode sebelumnya'], stopAtr: 2 };
    if (close < channel.lower && volumes.at(-1)! > averageVolume) return { action: 'sell', reason: ['close menembus Donchian lower sebelumnya', 'volume di atas rata-rata periode sebelumnya'], stopAtr: 2 };
    return hold('tidak ada breakout tervalidasi');
  },
  evaluateSeries: (candles) => {
    const channels: Array<DonchianChannel | undefined> = donchian(candles, 20);
    const volumes = candles.map((candle) => candle.volume);
    const averageVolume = sma(volumes, 20);
    const regimes = inferRegimeSeries(candles);
    const volatility = atr(candles);
    return candles.map((candle, i) => {
      const channel = channels[i];
      const previousVolumeMean = i > 0 ? averageVolume[i - 1] : undefined;
      if (!channel || previousVolumeMean === undefined || volatility[i] === undefined || regimes[i] !== 'trend') return hold('breakout menunggu channel/volume/regime');
      if (candle.close > channel.upper && candle.volume > previousVolumeMean) return { action: 'buy', reason: ['close menembus Donchian upper sebelumnya', 'volume di atas rata-rata periode sebelumnya'], stopAtr: 2 };
      if (candle.close < channel.lower && candle.volume > previousVolumeMean) return { action: 'sell', reason: ['close menembus Donchian lower sebelumnya', 'volume di atas rata-rata periode sebelumnya'], stopAtr: 2 };
      return hold('tidak ada breakout tervalidasi');
    });
  },
};

const meanReversion: StrategyDefinition = {
  slug: 'mean-reversion', name: 'RSI + Bollinger mean reversion',
  description: 'Mean reversion hanya pada regime sideways/range, bukan saat trend kuat.',
  evaluate: ({ candles, regime }) => {
    const values = closeSeries(candles);
    const momentum = rsi(values).at(-1), band = bollinger(values).at(-1), volatility = atr(candles).at(-1), close = values.at(-1);
    if (momentum === undefined || !band || volatility === undefined || close === undefined || regime !== 'range') return hold('mean reversion hanya untuk range');
    if (momentum < 30 && close < band.lower) return { action: 'buy', reason: ['RSI Wilder oversold', 'close di bawah Bollinger lower'], stopAtr: 1.5 };
    if (momentum > 70 && close > band.upper) return { action: 'sell', reason: ['RSI Wilder overbought', 'close di atas Bollinger upper'], stopAtr: 1.5 };
    return hold('tidak ada deviasi range yang cukup');
  },
  evaluateSeries: (candles) => {
    const values = closeSeries(candles), momentum = rsi(values), bands = bollinger(values), volatility = atr(candles), regimes = inferRegimeSeries(candles);
    return candles.map((candle, i) => {
      const band = bands[i];
      if (momentum[i] === undefined || !band || volatility[i] === undefined || regimes[i] !== 'range') return hold('mean reversion hanya untuk range');
      if (momentum[i]! < 30 && candle.close < band.lower) return { action: 'buy', reason: ['RSI Wilder oversold', 'close di bawah Bollinger lower'], stopAtr: 1.5 };
      if (momentum[i]! > 70 && candle.close > band.upper) return { action: 'sell', reason: ['RSI Wilder overbought', 'close di atas Bollinger upper'], stopAtr: 1.5 };
      return hold('tidak ada deviasi range yang cukup');
    });
  },
};

export const strategyRegistry: Readonly<Record<string, StrategyDefinition>> = {
  [trendFollowing.slug]: trendFollowing,
  [breakout.slug]: breakout,
  [meanReversion.slug]: meanReversion,
};
export const getStrategy = (slug: string) => strategyRegistry[slug];

/** Built-ins compute indicator series once; custom test strategies retain a causal fallback. */
export function evaluateStrategySeries(strategy: StrategyDefinition, candles: IndicatorCandle[]): StrategySignal[] {
  if (strategy.evaluateSeries) return strategy.evaluateSeries(candles);
  const regimes = inferRegimeSeries(candles);
  return candles.map((_, index) => strategy.evaluate({ candles: candles.slice(0, index + 1), regime: regimes[index] ?? 'range' }));
}

export type ActivationEvidence = {
  backtestComplete: boolean;
  outOfSampleComplete: boolean;
  sensitivityChecked: boolean;
  forwardTestDays: number;
  maxDrawdownFraction: number;
  maxAllowedDrawdownFraction: number;
  forwardTestCoverageValid?: boolean;
  taxConfigVerified?: boolean;
  sensitivityScenarioCount?: number;
  sensitivityMetricsValid?: boolean;
  sensitivityWorstDrawdownFraction?: number;
  sensitivityWorstExpectancyR?: number;
  sensitivityWorstProfitFactor?: number | null;
  outOfSampleTradeCount?: number;
  outOfSampleExpectancyR?: number;
  outOfSampleProfitFactor?: number | null;
};

export function activationGate(evidence: ActivationEvidence): { active: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!evidence.backtestComplete) reasons.push('backtest_required');
  if (!evidence.outOfSampleComplete) reasons.push('out_of_sample_required');
  if (!evidence.sensitivityChecked) reasons.push('sensitivity_required');
  if ((evidence.sensitivityScenarioCount ?? 0) < 7 || evidence.sensitivityMetricsValid !== true) reasons.push('quantitative_sensitivity_required');
  if (evidence.sensitivityWorstDrawdownFraction !== undefined && evidence.sensitivityWorstDrawdownFraction > evidence.maxAllowedDrawdownFraction) reasons.push('sensitivity_drawdown_threshold_exceeded');
  if (evidence.sensitivityWorstExpectancyR !== undefined && evidence.sensitivityWorstExpectancyR <= 0) reasons.push('sensitivity_expectancy_not_positive');
  if (evidence.sensitivityWorstProfitFactor !== undefined && evidence.sensitivityWorstProfitFactor !== null && evidence.sensitivityWorstProfitFactor < 1) reasons.push('sensitivity_profit_factor_below_one');
  if ((evidence.outOfSampleTradeCount ?? 0) < 30) reasons.push('out_of_sample_sample_size_insufficient');
  if (evidence.outOfSampleExpectancyR !== undefined && evidence.outOfSampleExpectancyR <= 0) reasons.push('out_of_sample_expectancy_not_positive');
  if (evidence.outOfSampleProfitFactor !== undefined && (evidence.outOfSampleProfitFactor === null || evidence.outOfSampleProfitFactor < 1)) reasons.push('out_of_sample_profit_factor_below_one');
  if (evidence.forwardTestDays < 14) reasons.push('forward_test_14_days_required');
  if (evidence.forwardTestCoverageValid === false) reasons.push('forward_test_coverage_invalid');
  if (evidence.taxConfigVerified === false) reasons.push('fee_tax_configuration_unverified');
  if (evidence.maxDrawdownFraction > evidence.maxAllowedDrawdownFraction) reasons.push('drawdown_threshold_exceeded');
  return { active: reasons.length === 0, reasons };
}
