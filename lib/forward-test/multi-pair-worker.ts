import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db/client';
import { getMarketOverview, getPairById, getHistoricalCandles } from '@/lib/indodax/client';
import type { Pair } from '@/lib/indodax/schemas';
import type { MarketSnapshot } from '@/lib/indodax/normalize';
import { latestClosedCandle } from '@/lib/paper/signals';
import { getStrategy } from '@/lib/strategy/registry';
import { atr, type IndicatorCandle } from '@/lib/strategy/indicators';
import { regimeForStrategy } from '@/lib/strategy/evaluation';
import { MultiPairScanRepository, MULTI_PAIR_TIMEFRAME, type MultiPairScanRun, type MultiPairUniverse } from './multi-pair-repository';
import { selectMultiPairUniverse, MULTI_PAIR_MAX_PAIRS, MULTI_PAIR_MIN_VOLUME_IDR, MULTI_PAIR_MAX_SPREAD_BPS } from './multi-pair-universe';

const POLL_MS = 60_000;
const CANDLE_MS = 60 * 60_000;
const MAX_LATENESS_MS = 15 * 60_000;
const LOCK_NAMESPACE = 1_401_102;
const LOCK_ID = 14_338;
const strategy = getStrategy('trend-following');
const repository = new MultiPairScanRepository();
let started = false;

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function indicatorCandles(candles: Awaited<ReturnType<typeof getHistoricalCandles>>): IndicatorCandle[] {
  return candles.map((candle) => ({ high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume) }));
}

async function pairMetadata(markets: MarketSnapshot[]): Promise<Pair[]> {
  const results = await Promise.all(markets.map((market) => getPairById(market.pairId).catch(() => undefined)));
  return results.filter((pair): pair is Pair => pair !== undefined);
}

async function buildUniverse(nowMs: number): Promise<MultiPairUniverse> {
  const overview = await getMarketOverview();
  const pairs = await pairMetadata(overview.markets);
  const candidates = selectMultiPairUniverse(overview.markets, pairs, nowMs, MULTI_PAIR_MAX_PAIRS * 2);
  const selected: MultiPairUniverse['pairs'] = [];
  for (const candidate of candidates) {
    try {
      const history = await getHistoricalCandles(candidate.pairId, nowMs - 35 * 86_400_000, nowMs, MULTI_PAIR_TIMEFRAME);
      const closed = history.filter((candle) => candle.closeTimeMs <= nowMs);
      if (closed.length >= 200) selected.push(candidate);
      if (selected.length >= MULTI_PAIR_MAX_PAIRS) break;
    } catch (error) {
      console.warn('[multi-pair-scan] skipped during warmup:', candidate.pairId, error instanceof Error ? error.message.slice(0, 180) : 'unknown');
    }
  }
  if (selected.length === 0) throw new Error('Tidak ada pair IDR yang lolos filter likuiditas, spread, fee, dan warmup 200 candle.');
  return {
    strategySlug: 'trend-following',
    strategyVersion: '1.0.0',
    timeframe: MULTI_PAIR_TIMEFRAME,
    scanOnly: true,
    maxPairs: MULTI_PAIR_MAX_PAIRS,
    minimumVolumeIdr24h: MULTI_PAIR_MIN_VOLUME_IDR,
    maximumSpreadBps: MULTI_PAIR_MAX_SPREAD_BPS,
    pairs: selected,
  };
}

async function scanOne(run: MultiPairScanRun, pair: MultiPairUniverse['pairs'][number], market: MarketSnapshot, nowMs: number): Promise<void> {
  const history = await getHistoricalCandles(pair.pairId, nowMs - 35 * 86_400_000, nowMs, run.universe.timeframe);
  const sorted = [...history].sort((a, b) => a.closeTimeMs - b.closeTimeMs);
  const candle = latestClosedCandle(sorted, nowMs);
  if (!candle || candle.closeTimeMs <= run.startedAtMs) return;
  if (nowMs - candle.closeTimeMs > MAX_LATENESS_MS) {
    await repository.recordError(run.id, `Candle ${pair.pairId} terlambat dipindai lebih dari 15 menit; coverage tidak boleh dianggap live.`, nowMs);
    return;
  }
  if (await repository.latestClose(run.id, pair.pairId) >= candle.closeTimeMs) return;
  const indicators = indicatorCandles(sorted.filter((item) => item.closeTimeMs <= candle.closeTimeMs));
  if (indicators.length < 200) {
    await repository.recordError(run.id, `Warm-up belum mencapai 200 candle untuk ${pair.pairId}.`, nowMs);
    return;
  }
  if (!strategy) throw new Error('Strategi trend-following tidak terdaftar.');
  const signal = strategy.evaluate({ candles: indicators, regime: regimeForStrategy(sorted) });
  const volatility = atr(indicators).at(-1);
  const saved = await repository.recordObservation({
    runId: run.id,
    pairId: pair.pairId,
    timeframe: run.universe.timeframe,
    openTimeMs: candle.openTimeMs,
    closeTimeMs: candle.closeTimeMs,
    action: signal.action,
    reasons: signal.reason,
    candle: { open: String(candle.open), high: String(candle.high), low: String(candle.low), close: String(candle.close), volumeBase: String(candle.volume), atr: volatility ?? null },
    market: { observedLast: market.last, buy: market.buy, sell: market.sell, volumeIdr24h: market.volumeIdr24h, spreadBps: pair.spreadBps, sourceUpdatedAtMs: market.updatedAtMs },
    observedAtMs: nowMs,
  });
  if (saved.gap) console.warn('[multi-pair-scan] candle gap:', pair.pairId, candle.closeTimeMs);
}

async function processCycle(lockClient: PoolClient): Promise<void> {
  await lockClient.query('SELECT 1');
  const nowMs = Date.now();
  const existingRun = await repository.getRun();
  if (!existingRun) {
    await repository.ensureRun(await buildUniverse(nowMs), nowMs);
    return;
  }
  const run = existingRun;
  if (run.status !== 'running') return;
  await repository.heartbeat(run.id, nowMs);
  const overview = await getMarketOverview();
  const marketById = new Map(overview.markets.map((market) => [market.pairId, market]));
  const pairs = run.universe.pairs;
  for (let offset = 0; offset < pairs.length; offset += 4) {
    const batch = pairs.slice(offset, offset + 4);
    await Promise.all(batch.map(async (pair) => {
      const market = marketById.get(pair.pairId);
      if (!market || market.status !== 'live' || nowMs - market.updatedAtMs > 30_000) return;
      try {
        await scanOne(run!, pair, market, nowMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : `Gagal scan ${pair.pairId}.`;
        console.error('[multi-pair-scan] pair failed:', pair.pairId, message.slice(0, 300));
        await repository.recordError(run!.id, `${pair.pairId}: ${message}`, Date.now());
      }
    }));
  }
}

async function workerLoop(): Promise<void> {
  while (true) {
    let lockClient: PoolClient | undefined;
    let ownsLock = false;
    try {
      lockClient = await getDbPool().connect();
      const result = await lockClient.query('SELECT pg_try_advisory_lock($1,$2) AS locked', [LOCK_NAMESPACE, LOCK_ID]);
      ownsLock = result.rows[0]?.locked === true;
      if (!ownsLock) {
        lockClient.release();
        lockClient = undefined;
        await sleep(POLL_MS);
        continue;
      }
      let lost = false;
      lockClient.on('error', () => { lost = true; });
      while (!lost) {
        try {
          await processCycle(lockClient);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Multi-pair scanner gagal.';
          console.error('[multi-pair-scan] cycle failed:', message.slice(0, 400));
          try {
            const run = await repository.getRun();
            if (run?.status === 'running') await repository.recordError(run.id, message);
          } catch { /* The database may be unavailable. */ }
        }
        await sleep(POLL_MS);
        if (lost) break;
        try { await lockClient.query('SELECT 1'); } catch { lost = true; }
      }
    } catch (error) {
      console.error('[multi-pair-scan] lock loop failed:', error instanceof Error ? error.message.slice(0, 300) : 'unknown');
      await sleep(POLL_MS);
    } finally {
      if (lockClient) {
        if (ownsLock) {
          try { await lockClient.query('SELECT pg_advisory_unlock($1,$2)', [LOCK_NAMESPACE, LOCK_ID]); } catch { /* Connection already lost. */ }
        }
        lockClient.release(true);
      }
    }
  }
}

export function startMultiPairScanner(): void {
  if (started || process.env.NODE_ENV !== 'production' || !strategy) return;
  started = true;
  void workerLoop().catch((error) => {
    started = false;
    console.error('[multi-pair-scan] stopped unexpectedly:', error instanceof Error ? error.message.slice(0, 300) : 'unknown');
  });
}
