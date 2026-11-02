import { NextResponse } from 'next/server';
import { getHistoricalCandles, IndodaxRequestError } from '@/lib/indodax/client';
import { getStrategy } from '@/lib/strategy/registry';
import { decisionRecord, latestClosedCandle } from '@/lib/paper/signals';
import { regimeForStrategy } from '@/lib/strategy/evaluation';
import { acquireApiRequest } from '@/lib/server/rate-limit';
import { cachedResponse } from '@/lib/server/response-cache';

export const dynamic = 'force-dynamic';
const TIMEFRAMES = new Set(['15', '60', '240', '1D']);
const ALLOWED_QUERY = new Set(['strategy', 'pair', 'tf']);
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) if (!ALLOWED_QUERY.has(key) || url.searchParams.getAll(key).length !== 1) return response({ ok: false, error: 'Parameter request tidak valid.' }, 400);
  const strategySlug = url.searchParams.get('strategy') ?? 'trend-following';
  const pair = (url.searchParams.get('pair') ?? 'btcidr').toLowerCase();
  const timeframe = url.searchParams.get('tf') ?? '60';
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(pair) || !TIMEFRAMES.has(timeframe)) return response({ ok: false, error: 'Pair atau timeframe tidak diizinkan.' }, 400);
  const strategy = getStrategy(strategySlug);
  if (!strategy) return response({ ok: false, error: 'Strategi tidak ditemukan.' }, 404);

  let guard;
  try { guard = await acquireApiRequest(request, '/api/signals', { limit: 60, windowMs: 60_000, concurrency: 4, leaseMs: 30_000 }); }
  catch { return response({ ok: false, error: 'Rate limiter belum tersedia.' }, 503); }
  if (!guard.allowed) return NextResponse.json({ ok: false, error: 'Batas request terlampaui; coba lagi nanti.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(guard.retryAfterSeconds) } });

  try {
    const payload = await cachedResponse(`signals:${strategySlug}:${pair}:${timeframe}`, 5_000, async () => {
      const nowMs = Date.now();
      const days = timeframe === '15' ? 45 : 90;
      const candles = await getHistoricalCandles(pair, nowMs - days * 86_400_000, nowMs, timeframe);
      const maximumCandles = 6_000;
      if (candles.length > maximumCandles) throw new Error('HISTORY_LIMIT');
      const candle = latestClosedCandle(candles, nowMs);
      if (!candle) return { ok: true, signal: null, reason: 'Belum ada candle tertutup yang valid.' };
      const regime = regimeForStrategy(strategy, candles);
      const evaluated = strategy.evaluate({ regime, candles: candles.map((item) => ({ high: Number(item.high), low: Number(item.low), close: Number(item.close), volume: Number(item.volume) })) });
      const decision = decisionRecord(strategy.slug, pair, candle, evaluated.action, evaluated.reason, nowMs);
      return { ok: true, signal: decision, regime, candle: { closeTimeMs: candle.closeTimeMs, close: candle.close, source: candle.source }, activation: { active: false, reason: 'Forward-test paper 14 hari dan quantitative sensitivity gate belum terpenuhi.' } };
    });
    return response(payload);
  } catch (error) {
    if (error instanceof IndodaxRequestError) return response({ ok: false, error: error.status === 403 ? 'Sumber data pasar menolak akses.' : 'Sumber data pasar tidak tersedia atau tidak valid.' }, 503);
    return response({ ok: false, error: error instanceof Error && error.message === 'HISTORY_LIMIT' ? 'Data historis melebihi batas resource.' : 'Sinyal tidak dapat dihitung.' }, 502);
  } finally {
    await guard.release().catch(() => undefined);
  }
}
