import { NextResponse } from 'next/server';
import { getHistoricalCandles, getPairById } from '@/lib/indodax/client';
import { formatTime } from '@/lib/format';
import { runBacktest, walkForwardSplits } from '@/lib/strategy/backtest';
import { getStrategy, activationGate } from '@/lib/strategy/registry';
import { regimeForStrategy } from '@/lib/strategy/evaluation';
import { performanceMetrics } from '@/lib/paper/metrics';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const strategySlug = url.searchParams.get('strategy') ?? 'trend-following';
  const pair = url.searchParams.get('pair') ?? 'btcidr';
  const timeframe = url.searchParams.get('tf') ?? '60';
  const requestedDays = Number(url.searchParams.get('days') ?? 90);
  const days = Number.isFinite(requestedDays) ? Math.min(365, Math.max(30, requestedDays)) : 90;
  const strategy = getStrategy(strategySlug);
  if (!strategy) return NextResponse.json({ ok: false, error: 'Strategi tidak ditemukan.' }, { status: 404 });

  try {
    const pairMeta = await getPairById(pair);
    if (!pairMeta) return NextResponse.json({ ok: false, error: `Pair ${pair} tidak ditemukan.` }, { status: 404 });
    const takerRate = pairMeta.trade_fee_percent_taker ?? pairMeta.trade_fee_percent;
    if (takerRate === undefined) return NextResponse.json({ ok: false, error: 'Fee pair belum tersedia dari respons resmi; backtest ditahan.' }, { status: 424 });

    const endMs = Date.now();
    const candles = await getHistoricalCandles(pair, endMs - days * 86_400_000, endMs, timeframe);
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
    // Keep the pre-validation candles for indicator warm-up, but score only trades opened in each period.
    const validation = runBacktest(candles, strategy, {
      ...commonOptions,
      fromIndex: splits.trainEnd,
      endIndexExclusive: splits.validationEnd,
    });
    const outOfSample = runBacktest(candles, strategy, {
      ...commonOptions,
      fromIndex: splits.validationEnd,
      endIndexExclusive: candles.length,
    });
    const sensitivity = [fee.takerRate, String(Number(fee.takerRate) * 1.5)].map((takerRateVariant) =>
      runBacktest(candles, strategy, { ...commonOptions, fee: { ...fee, takerRate: takerRateVariant } }),
    );
    const metrics = performanceMetrics(result.trades, initialEquity);
    const outOfSampleMetrics = performanceMetrics(outOfSample.trades, initialEquity);
    const evidence = {
      backtestComplete: candles.length >= 500 && result.trades.length > 0,
      outOfSampleComplete: splits.outOfSample.length >= 100 && outOfSample.trades.length > 0,
      sensitivityChecked: sensitivity.every((item) => item.lookAheadSafe),
      forwardTestDays: 0,
      maxDrawdownFraction: metrics.maxDrawdown,
      maxAllowedDrawdownFraction: 0.2,
    };
    const gate = activationGate(evidence);

    return NextResponse.json({
      ok: true,
      strategy: strategy.slug,
      pair,
      timeframe,
      regime: regimeForStrategy(strategy, candles),
      candles: candles.length,
      model: {
        marketType: 'spot-long-only',
        initialEquity,
        riskPerTrade: riskFraction,
        stop: 'ATR-based, strategy stopAtr or 2x ATR default',
        signalTiming: 'closed candle; entry/exit no earlier than next candle open',
        shortSelling: false,
        slippage: 'not modeled',
      },
      fee,
      period: {
        start: result.startMs ? formatTime(result.startMs) : null,
        end: result.endMs ? formatTime(result.endMs) : null,
      },
      backtest: { trades: result.trades.length, equity: result.equity, metrics },
      validation: {
        candles: splits.validation.length,
        trades: validation.trades.length,
        equity: validation.equity,
        metrics: performanceMetrics(validation.trades, initialEquity),
      },
      outOfSample: {
        candles: splits.outOfSample.length,
        trades: outOfSample.trades.length,
        equity: outOfSample.equity,
        metrics: outOfSampleMetrics,
      },
      sensitivity: sensitivity.map((item) => ({ trades: item.trades.length, equity: item.equity })),
      evidence,
      activation: gate,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Backtest gagal.' }, { status: 502 });
  }
}
