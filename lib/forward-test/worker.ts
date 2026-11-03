import Decimal from 'decimal.js';
import type { PoolClient } from 'pg';
import { getMarketDetail, getMarketOverview, getHistoricalCandles, getPairById } from '@/lib/indodax/client';
import { decisionRecord, latestClosedCandle } from '@/lib/paper/signals';
import { simulateMarketFill, validateOrderConstraints } from '@/lib/paper/execution';
import type { ClosedCandle, FeeConfig, Fill, ValidatedOrderBook } from '@/lib/paper/types';
import { ForwardTestRepository, type ForwardTestConfig, type ForwardTestRun } from './repository';
import { getStrategy } from '@/lib/strategy/registry';
import { atr, type IndicatorCandle } from '@/lib/strategy/indicators';
import { closedCandlesThrough, regimeForStrategy } from '@/lib/strategy/evaluation';
import { getDbPool } from '@/lib/db/client';
import { candleObservationIssue, shouldStartForwardTestWorker } from './worker-guards';

const POLL_INTERVAL_MS = 60_000;
const LOCK_NAMESPACE = 1_401_102;
const LOCK_ID = 14_337;
const strategy = getStrategy('trend-following');
const repository = new ForwardTestRepository();
const D = (value: string | number) => new Decimal(value);
let started = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function indicatorCandles(candles: ClosedCandle[]): IndicatorCandle[] {
  return candles.map((candle) => ({ high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume) }));
}

function feeConfig(run: ForwardTestRun): FeeConfig {
  return {
    makerRate: String(run.config.makerRate ?? '0'),
    takerRate: String(run.config.takerRate ?? '0'),
    taxRate: String(run.config.taxRate ?? '0'),
    sourceUrl: String(run.config.feeSourceUrl ?? 'https://indodax.com/api/pairs'),
    effectiveFrom: String(run.config.feeEffectiveFrom ?? new Date(run.startedAtMs).toISOString()),
  };
}

function validatedBook(detail: Awaited<ReturnType<typeof getMarketDetail>>, pairId: string): ValidatedOrderBook {
  if (detail.market.status !== 'live') throw new Error('Ticker/orderbook Indodax stale; paper fill dihentikan.');
  return {
    pairId,
    updatedAtMs: detail.market.updatedAtMs,
    status: 'live',
    bids: detail.depth.buy.map(([price, amount]) => ({ price: String(price), amount: String(amount) })),
    asks: detail.depth.sell.map(([price, amount]) => ({ price: String(price), amount: String(amount) })),
  };
}

function incrementFloor(value: Decimal, increment?: string): Decimal {
  if (!increment || !D(increment).gt(0)) return value;
  return value.div(increment).floor().mul(increment);
}

function asOptionalString(value: string | number | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = String(value);
  return D(parsed).isFinite() && D(parsed).gt(0) ? parsed : undefined;
}

async function buildConfig(): Promise<ForwardTestConfig> {
  const pair = await getPairById('btcidr');
  if (!pair) throw new Error('Metadata BTCIDR belum tersedia; forward-test ditahan.');
  const takerFee = pair.trade_fee_percent_taker ?? pair.trade_fee_percent;
  if (takerFee === undefined || !Number.isFinite(Number(takerFee))) throw new Error('Fee taker BTCIDR belum tersedia; forward-test ditahan.');
  const makerFee = pair.trade_fee_percent_maker ?? pair.trade_fee_percent ?? takerFee;
  return {
    pairId: pair.id,
    timeframe: '60',
    initialEquity: '10000000',
    riskFraction: '0.01',
    makerRate: String(Number(makerFee) / 100),
    takerRate: String(Number(takerFee) / 100),
    taxRate: '0',
    taxVerified: false,
    feeSourceUrl: 'https://indodax.com/api/pairs',
    feeEffectiveFrom: new Date().toISOString(),
    priceIncrement: asOptionalString(pair.price_round),
    quantityIncrement: asOptionalString(pair.quantity_increment),
    minimumBase: asOptionalString(pair.trade_min_base_currency),
    minimumQuote: asOptionalString(pair.trade_min_traded_currency),
  };
}

async function getFreshFill(
  run: ForwardTestRun,
  tickerId: string,
  side: 'buy' | 'sell',
  baseAmount: string,
  nowMs: number,
): Promise<Fill> {
  const detail = await getMarketDetail(tickerId);
  const book = validatedBook(detail, run.pairId);
  return simulateMarketFill(
    { idempotencyKey: `${run.id}:${run.pairId}:${nowMs}:${side}`, pairId: run.pairId, side, baseAmount, createdAtMs: nowMs },
    book,
    feeConfig(run),
    nowMs,
  );
}

async function tryStopExit(run: ForwardTestRun, nowMs: number): Promise<void> {
  const portfolio = await repository.getPortfolio(run);
  if (!portfolio.position?.stopPrice || !portfolio.position.entryFillId) return;
  const overview = await getMarketOverview();
  const market = overview.markets.find((item) => item.pairId === run.pairId);
  if (!market || market.status !== 'live' || nowMs - market.updatedAtMs > 30_000) return;
  if (D(market.last).gt(portfolio.position.stopPrice)) return;
  const fill = await getFreshFill(run, market.tickerId, 'sell', portfolio.position.baseAmount, nowMs);
  await repository.recordStopExit(run.id, fill, nowMs);
}

async function makeSignalFill(
  run: ForwardTestRun,
  candle: ClosedCandle,
  history: ClosedCandle[],
  action: 'buy' | 'sell' | 'hold',
  nowMs: number,
): Promise<{ fill?: Fill; stopPrice?: string; riskBudget?: string; riskBlock?: string }> {
  if (action === 'hold') return {};
  const portfolio = await repository.getPortfolio(run);
  const overview = await getMarketOverview();
  const market = overview.markets.find((item) => item.pairId === run.pairId);
  if (!market || market.status !== 'live' || nowMs - market.updatedAtMs > 30_000) return { riskBlock: 'market_stale_or_missing' };

  if (action === 'sell') {
    if (!portfolio.position) return { riskBlock: 'sell_while_flat_spot_long_only' };
    try {
      const fill = await getFreshFill(run, market.tickerId, 'sell', portfolio.position.baseAmount, nowMs);
      return { fill };
    } catch (error) {
      return { riskBlock: error instanceof Error ? error.message : 'sell_fill_unavailable' };
    }
  }

  if (portfolio.position) return { riskBlock: 'one_position_per_strategy' };
  const equity = D(portfolio.cash);
  const dailyStop = equity.mul('0.03').neg();
  if (D(portfolio.realizedPnl24h).lte(dailyStop)) return { riskBlock: 'daily_loss_circuit_breaker_3_percent' };

  const detail = await getMarketDetail(market.tickerId);
  const book = validatedBook(detail, run.pairId);
  if (!book.asks[0]) return { riskBlock: 'empty_ask_book' };
  const entry = D(book.asks[0].price);
  const currentIndicators = indicatorCandles(history);
  const atrValue = atr(currentIndicators).at(-1);
  if (atrValue === undefined || !Number.isFinite(atrValue) || atrValue <= 0) return { riskBlock: 'atr_unavailable' };
  const signal = strategy?.evaluate({ candles: currentIndicators, regime: regimeForStrategy(history) });
  const multiple = signal?.stopAtr ?? 2;
  const stop = entry.sub(D(atrValue).mul(multiple));
  if (stop.lte(0)) return { riskBlock: 'invalid_atr_stop' };

  const fees = feeConfig(run);
  const maxRisk = equity.mul(String(run.config.riskFraction ?? '0.01'));
  const riskPerUnit = entry.sub(stop).add(entry.add(stop).mul(D(fees.takerRate).add(fees.taxRate)));
  if (riskPerUnit.lte(0)) return { riskBlock: 'invalid_risk_per_unit' };
  const qtyByRisk = maxRisk.div(riskPerUnit);
  const qtyByCash = D(portfolio.cash).div(entry.mul(new Decimal(1).add(fees.takerRate).add(fees.taxRate)));
  const quantityIncrement = typeof run.config.quantityIncrement === 'string' ? run.config.quantityIncrement : undefined;
  const baseAmount = incrementFloor(Decimal.min(qtyByRisk, qtyByCash), quantityIncrement);
  if (baseAmount.lte(0)) return { riskBlock: 'sized_quantity_zero' };
  const constraints = validateOrderConstraints(entry.toString(), baseAmount.toString(), {
    priceIncrement: typeof run.config.priceIncrement === 'string' ? run.config.priceIncrement : undefined,
    quantityIncrement,
    minimumBase: typeof run.config.minimumBase === 'string' ? run.config.minimumBase : undefined,
    minimumQuote: typeof run.config.minimumQuote === 'string' ? run.config.minimumQuote : undefined,
  });
  if (constraints.length) return { riskBlock: `order_constraints:${constraints.join(',')}` };

  try {
    const fill = simulateMarketFill(
      { idempotencyKey: `${run.id}:${candle.closeTimeMs}:buy`, pairId: run.pairId, side: 'buy', baseAmount: baseAmount.toFixed(), createdAtMs: nowMs },
      book,
      fees,
      nowMs,
    );
    const stopLossIncludingBothFees = D(fill.baseAmount)
      .mul(D(fill.averagePrice).sub(stop))
      .add(fill.feeAmount)
      .add(fill.taxAmount)
      .add(D(fill.baseAmount).mul(stop).mul(D(fees.takerRate).add(fees.taxRate)));
    if (stopLossIncludingBothFees.gt(maxRisk)) return { riskBlock: 'orderbook_slippage_exceeds_1_percent_risk_budget' };
    return { fill, stopPrice: stop.toFixed(), riskBudget: maxRisk.toFixed() };
  } catch (error) {
    return { riskBlock: error instanceof Error ? error.message : 'buy_fill_unavailable' };
  }
}

async function processCycle(lockClient: PoolClient): Promise<void> {
  await lockClient.query('SELECT 1');
  const freshConfig = await buildConfig();
  const run = await repository.ensureRun(freshConfig);
  if (run.status !== 'running') return;
  const currentTakerRate = freshConfig.takerRate;
  if (String(run.config.takerRate) !== currentTakerRate || String(run.config.makerRate) !== freshConfig.makerRate) {
    await repository.invalidate(run.id, 'Biaya pair berubah selama run; konfigurasi uji dibekukan dan perlu run baru.');
    return;
  }

  const nowMs = Date.now();
  await repository.heartbeat(run.id, nowMs);
  await tryStopExit(run, nowMs);
  const candles = await getHistoricalCandles(run.pairId, nowMs - 35 * 86_400_000, nowMs, run.timeframe);
  const sorted = [...candles].sort((a, b) => a.closeTimeMs - b.closeTimeMs);
  const candle = latestClosedCandle(sorted, nowMs);
  if (!candle) return;
  const observationIssue = candleObservationIssue({ lastProcessedCloseMs: run.lastProcessedCloseMs, candleCloseMs: candle.closeTimeMs, runStartedAtMs: run.startedAtMs, nowMs });
  if (observationIssue === 'historical_before_start' || observationIssue === 'duplicate_or_old') return;
  if (observationIssue === 'candle_late') {
    await repository.invalidate(run.id, 'Candle tertutup terlambat diproses (>15 menit); forward coverage tidak dapat dianggap live.', nowMs, candle.closeTimeMs);
    return;
  }
  if (observationIssue === 'candle_gap') {
    await repository.invalidate(run.id, 'Gap candle 1 jam tidak dapat dipulihkan sebagai observasi live.', nowMs, candle.closeTimeMs);
    return;
  }

  const history = closedCandlesThrough(sorted, candle.closeTimeMs);
  if (history.length < 200) {
    await repository.recordWorkerError(run.id, 'Warm-up candle belum mencapai 200 bar; keputusan belum diproses.', nowMs);
    return;
  }
  if (!strategy) {
    await repository.invalidate(run.id, 'Strategi trend-following tidak terdaftar.', nowMs, candle.closeTimeMs);
    return;
  }
  const regime = regimeForStrategy(history);
  const indicators = indicatorCandles(history);
  const signal = strategy.evaluate({ candles: indicators, regime });
  const decision = decisionRecord(strategy.slug, run.pairId, candle, signal.action, signal.reason, nowMs);
  const trade = await makeSignalFill(run, candle, history, signal.action, nowMs);
  await repository.recordObservation({ runId: run.id, candle, decision, processedAtMs: nowMs, ...trade });
}

async function workerLoop(): Promise<void> {
  while (true) {
    let lockClient: PoolClient | undefined;
    let ownsLock = false;
    try {
      lockClient = await getDbPool().connect();
      const result = await lockClient.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [LOCK_NAMESPACE, LOCK_ID]);
      ownsLock = result.rows[0]?.locked === true;
      if (!ownsLock) {
        lockClient.release();
        lockClient = undefined;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      let connectionLost = false;
      lockClient.on('error', () => { connectionLost = true; });
      while (!connectionLost) {
        try {
          await processCycle(lockClient);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Forward-test worker gagal.';
          console.error('[forward-test] cycle failed:', message.slice(0, 400));
          try {
            const run = await repository.getRun();
            if (run?.status === 'running') await repository.recordWorkerError(run.id, message);
          } catch (stateError) {
            console.error('[forward-test] state update failed:', stateError instanceof Error ? stateError.message.slice(0, 300) : 'unknown');
          }
        }
        await sleep(POLL_INTERVAL_MS);
        if (connectionLost) break;
        try { await lockClient.query('SELECT 1'); } catch { connectionLost = true; }
      }
    } catch (error) {
      console.error('[forward-test] lock loop failed:', error instanceof Error ? error.message.slice(0, 400) : 'unknown');
      await sleep(POLL_INTERVAL_MS);
    } finally {
      if (lockClient) {
        if (ownsLock) {
          try { await lockClient.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE, LOCK_ID]); } catch { /* DB connection may already be gone. */ }
        }
        lockClient.release(true);
      }
    }
  }
}

export function startForwardTestWorker(): void {
  if (started || !shouldStartForwardTestWorker(process.env.NEXT_RUNTIME, process.env.NODE_ENV, Boolean(strategy))) return;
  started = true;
  void workerLoop().catch((error) => {
    started = false;
    console.error('[forward-test] worker stopped unexpectedly:', error instanceof Error ? error.message.slice(0, 400) : 'unknown');
  });
}
