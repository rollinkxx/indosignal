import { NextResponse } from 'next/server';
import { getHistoricalCandles } from '@/lib/indodax/client';
import { getStrategy } from '@/lib/strategy/registry';
import { decisionRecord, latestClosedCandle } from '@/lib/paper/signals';
import { regimeForStrategy } from '@/lib/strategy/evaluation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const strategySlug = url.searchParams.get('strategy') ?? 'trend-following';
  const pair = url.searchParams.get('pair') ?? 'btcidr';
  const strategy = getStrategy(strategySlug);
  if (!strategy) return NextResponse.json({ ok: false, error: 'Strategi tidak ditemukan.' }, { status: 404 });
  try {
    const nowMs = Date.now();
    const candles = await getHistoricalCandles(pair, nowMs - 90 * 86_400_000, nowMs, url.searchParams.get('tf') ?? '60');
    const candle = latestClosedCandle(candles, nowMs);
    if (!candle) return NextResponse.json({ ok: true, signal: null, reason: 'Belum ada candle tertutup yang valid.' });
    const regime = regimeForStrategy(strategy, candles);
    const evaluated = strategy.evaluate({ regime, candles: candles.map((item) => ({ high: Number(item.high), low: Number(item.low), close: Number(item.close), volume: Number(item.volume) })) });
    const decision = decisionRecord(strategy.slug, pair, candle, evaluated.action, evaluated.reason, nowMs);
    return NextResponse.json({ ok: true, signal: decision, regime, candle: { closeTimeMs: candle.closeTimeMs, close: candle.close, source: candle.source }, activation: { active: false, reason: 'Forward-test paper 14 hari dan sensitivity check belum selesai.' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Sinyal gagal dihitung.' }, { status: 502 });
  }
}
