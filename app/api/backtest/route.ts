import { NextResponse } from 'next/server';
import { getHistoricalCandles, getPairById, IndodaxRequestError } from '@/lib/indodax/client';
import { formatTime } from '@/lib/format';
import { runBacktest, walkForwardSplits } from '@/lib/strategy/backtest';
import { getStrategy, activationGate } from '@/lib/strategy/registry';
import { regimeForStrategy } from '@/lib/strategy/evaluation';
import { performanceMetrics } from '@/lib/paper/metrics';
import { ForwardTestRepository } from '@/lib/forward-test/repository';
import { acquireApiRequest } from '@/lib/server/rate-limit';
import { cachedResponse } from '@/lib/server/response-cache';

export const dynamic = 'force-dynamic';
const ALLOWED_QUERY = new Set(['strategy', 'pair', 'tf', 'days']);
const ALLOWED_TIMEFRAMES = new Set(['15', '60', '240', '1D']);
const LIMIT = { limit: 12, windowMs: 60_000, concurrency: 2, leaseMs: 90_000 };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY.has(key) || url.searchParams.getAll(key).length !== 1) return response({ ok: false, error: 'Parameter request tidak valid.' }, 400);
  }
  const strategySlug = url.searchParams.get('strategy') ?? 'trend-following';
  const pair = (url.searchParams.get('pair') ?? 'btcidr').toLowerCase();
  const timeframe = url.searchParams.get('tf') ?? '60';
  const daysRaw = url.searchParams.get('days') ?? '90';
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(pair) || !ALLOWED_TIMEFRAMES.has(timeframe) || !/^\d{1,3}$/.test(daysRaw)) {
    return response({ ok: false, error: 'Pair, timeframe, atau rentang tidak diizinkan.' }, 400);
  }
  const days = Number(daysRaw);
  if (!Number.isInteger(days) || days < 30 || days > 365) return response({ ok: false, error: 'days harus antara 30 dan 365.' }, 400);
  const intervalMs = timeframe === '1D' ? 86_400_000 : Number(timeframe) * 60_000;
  if (Math.ceil(days * 86_400_000 / intervalMs) > 12_000) return response({ ok: false, error: 'Kombinasi days/timeframe melebihi batas 12.000 candle.' }, 400);
  const strategy = getStrategy(strategySlug);
  if (!strategy) return response({ ok: false, error: 'Strategi tidak ditemukan.' }, 404);

  let guard;
  try { guard = await acquireApiRequest(request, '/api/backtest', LIMIT); }
  catch { return response({ ok: false, error: 'Rate limiter belum tersedia.' }, 503); }
  if (!guard.allowed) return NextResponse.json({ ok: false, error: 'Batas request terlampaui; coba lagi nanti.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(guard.retryAfterSeconds) } });

  try {
    const cacheKey = `backtest:${strategySlug}:${pair}:${timeframe}:${days}`;
    const payload = await cachedResponse(cacheKey, 20_000, async () => {
      const pairMeta = await getPairById(pair);
      if (!pairMeta) throw Object.assign(new Error('PAIR_NOT_FOUND'), { code: 'PAIR_NOT_FOUND' });
      const takerRate = pairMeta.trade_fee_percent_taker ?? pairMeta.trade_fee_percent;
      if (takerRate === undefined) throw Object.assign(new Error('FEE_UNAVAILABLE'), { code: 'FEE_UNAVAILABLE' });

      const endMs = Date.now();
      const candles = await getHistoricalCandles(pair, endMs - days * 86_400_000, endMs, timeframe);
      const maximumCandles = 12_000;
      if (candles.length > maximumCandles || candles.length < 200) throw Object.assign(new Error('HISTORY_INCOMPLETE'), { code: 'HISTORY_INCOMPLETE' });
      const splits = walkForwardSplits(candles);
      const initialEquity = '10000000';
      const riskFraction = '0.01';
      const fee = {
        makerRate: String(Number(pairMeta.trade_fee_percent_maker ?? pairMeta.trade_fee_percent ?? takerRate) / 100),
        takerRate: String(Number(takerRate) / 100),
        taxRate: '0',
        sourceUrl: 'https://indodax.com/api/pairs',
        effectiveFrom: new Date().toISOString(),
      };
      const commonOptions = { initialEquity, riskFraction, fee };
      const result = runBacktest(candles, strategy, commonOptions);
      const validation = runBacktest(candles, strategy, { ...commonOptions, fromIndex: splits.trainEnd, endIndexExclusive: splits.validationEnd });
      const outOfSample = runBacktest(candles, strategy, { ...commonOptions, fromIndex: splits.validationEnd, endIndexExclusive: candles.length });
      const baselineMetrics = performanceMetrics(result.trades, initialEquity, result.equityCurve);
      const validationMetrics = performanceMetrics(validation.trades, initialEquity, validation.equityCurve);
      const outOfSampleMetrics = performanceMetrics(outOfSample.trades, initialEquity, outOfSample.equityCurve);

      const scenarios: Array<{ id: string; feeMultiplier: number; slippageBps: number; spreadBps: number; riskFraction: number; stopAtrMultiplier?: number }> = [
        { id: 'fee_1x', feeMultiplier: 1, slippageBps: 0, spreadBps: 0, riskFraction: 0.01 },
        { id: 'fee_1_5x', feeMultiplier: 1.5, slippageBps: 0, spreadBps: 0, riskFraction: 0.01 },
        { id: 'fee_2x', feeMultiplier: 2, slippageBps: 0, spreadBps: 0, riskFraction: 0.01 },
        { id: 'slippage_low', feeMultiplier: 1, slippageBps: 2, spreadBps: 0, riskFraction: 0.01 },
        { id: 'slippage_medium', feeMultiplier: 1, slippageBps: 10, spreadBps: 0, riskFraction: 0.01 },
        { id: 'slippage_high', feeMultiplier: 1, slippageBps: 30, spreadBps: 0, riskFraction: 0.01 },
        { id: 'spread_wide', feeMultiplier: 1, slippageBps: 0, spreadBps: 50, riskFraction: 0.01 },
        { id: 'risk_parameter_0_5x', feeMultiplier: 1, slippageBps: 10, spreadBps: 25, riskFraction: 0.005 },
        { id: 'risk_parameter_1_5x', feeMultiplier: 1, slippageBps: 10, spreadBps: 25, riskFraction: 0.015 },
        { id: 'stop_atr_1_5x', feeMultiplier: 1, slippageBps: 10, spreadBps: 25, riskFraction: 0.01, stopAtrMultiplier: 1.5 },
        { id: 'stop_atr_2_5x', feeMultiplier: 1, slippageBps: 10, spreadBps: 25, riskFraction: 0.01, stopAtrMultiplier: 2.5 },
      ];
      const sensitivity = scenarios.map((scenario) => {
        const adjustedFee = { ...fee, takerRate: String(Number(fee.takerRate) * scenario.feeMultiplier) };
        const variant = runBacktest(candles, strategy, { ...commonOptions, fee: adjustedFee, slippageBps: scenario.slippageBps, spreadBps: scenario.spreadBps, riskFraction: String(scenario.riskFraction), stopAtrMultiplier: scenario.stopAtrMultiplier });
        const metrics = performanceMetrics(variant.trades, initialEquity, variant.equityCurve);
        return { scenario: scenario.id, trades: variant.trades.length, equity: variant.equity, maxDrawdown: metrics.maxDrawdown, profitFactor: metrics.profitFactor, expectancyR: metrics.expectancyR };
      });
      const forwardTestStatus = await new ForwardTestRepository().getStatus();
      const forwardTestDays = forwardTestStatus?.qualified ? 14 : 0;
      const worstSensitivityDrawdown = Math.max(0, ...sensitivity.map((item) => item.maxDrawdown));
      const worstSensitivityExpectancy = Math.min(...sensitivity.map((item) => item.expectancyR));
      const finiteSensitivityProfitFactors = sensitivity.map((item) => item.profitFactor).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const worstSensitivityProfitFactor = finiteSensitivityProfitFactors.length ? Math.min(...finiteSensitivityProfitFactors) : null;
      const sensitivityMetricsValid = sensitivity.length === scenarios.length && sensitivity.every((item) =>
        Number.isFinite(Number(item.equity)) && Number.isFinite(item.maxDrawdown) && Number.isFinite(item.expectancyR) && Number(item.equity) > 0,
      );
      const sensitivityChecked = sensitivityMetricsValid && worstSensitivityDrawdown <= 0.3;
      const backtestComplete = candles.length >= 500 && result.trades.length >= 30;
      const outOfSampleComplete = splits.outOfSample.length >= 100 && outOfSample.trades.length >= 30 &&
        Number(outOfSampleMetrics.expectancyR) > 0 && Number(outOfSampleMetrics.profitFactor ?? 0) >= 1;
      const evidence = {
        backtestComplete,
        outOfSampleComplete,
        sensitivityChecked,
        sensitivityScenarioCount: sensitivity.length,
        sensitivityMetricsValid,
        sensitivityWorstDrawdownFraction: worstSensitivityDrawdown,
        sensitivityWorstExpectancyR: worstSensitivityExpectancy,
        sensitivityWorstProfitFactor: worstSensitivityProfitFactor,
        outOfSampleTradeCount: outOfSample.trades.length,
        outOfSampleExpectancyR: outOfSampleMetrics.expectancyR,
        outOfSampleProfitFactor: outOfSampleMetrics.profitFactor,
        forwardTestDays,
        forwardTestCoverageValid: forwardTestStatus?.qualified ?? false,
        taxConfigVerified: forwardTestStatus?.taxVerified ?? false,
        maxDrawdownFraction: baselineMetrics.maxDrawdown,
        maxAllowedDrawdownFraction: 0.2,
      };
      const gate = activationGate(evidence);
      const regime = regimeForStrategy(strategy, candles);
      return {
        ok: true,
        strategy: strategy.slug,
        pair,
        timeframe,
        regime,
        candles: candles.length,
        model: {
          marketType: 'spot-long-only', initialEquity, riskPerTrade: riskFraction,
          stop: 'ATR-based, strategy stopAtr or 2x ATR default; gap stop fills at next open',
          signalTiming: 'closed candle; fill no earlier than next candle open',
          shortSelling: false,
          costs: { feeSource: 'Indodax /api/pairs', taxRate: 0, taxNote: 'tax not verified; excluded and activation remains blocked', sensitivitySlippageBps: [2, 10, 30], sensitivitySpreadBps: [0, 50] },
          parameterSensitivity: { riskFraction: [0.005, 0.01, 0.015], stopAtrMultiplier: [1.5, 2, 2.5] },
        },
        fee,
        period: { start: result.startMs ? formatTime(result.startMs) : null, end: result.endMs ? formatTime(result.endMs) : null },
        backtest: { trades: result.trades.length, equity: result.equity, metrics: baselineMetrics, equitySamples: result.equityCurve.length, exposureMs: result.exposureMs },
        validation: { candles: splits.validation.length, trades: validation.trades.length, equity: validation.equity, metrics: validationMetrics },
        outOfSample: { candles: splits.outOfSample.length, trades: outOfSample.trades.length, equity: outOfSample.equity, metrics: outOfSampleMetrics },
        sensitivity,
        evidence,
        forwardTest: forwardTestStatus,
        activation: gate,
        dataQuality: { maxHistoricalDays: 365, expectedIntervalMs: intervalMs, candlesSortedAndValidated: true, openCandlesExcluded: true },
      };
    });
    return response(payload);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'PAIR_NOT_FOUND') return response({ ok: false, error: 'Pair tidak ditemukan pada metadata publik.' }, 404);
    if (error instanceof Error && 'code' in error && error.code === 'FEE_UNAVAILABLE') return response({ ok: false, error: 'Konfigurasi biaya pair belum tersedia.' }, 424);
    if (error instanceof Error && 'code' in error && error.code === 'HISTORY_INCOMPLETE') return response({ ok: false, error: 'Data historis kosong, tidak lengkap, atau melebihi batas resource.' }, 424);
    if (error instanceof IndodaxRequestError) return response({ ok: false, error: error.status === 403 ? 'Sumber data pasar menolak akses.' : 'Sumber data pasar tidak tersedia atau tidak valid.' }, 503);
    return response({ ok: false, error: 'Backtest tidak dapat diselesaikan.' }, 502);
  } finally {
    await guard.release().catch(() => undefined);
  }
}
