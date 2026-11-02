import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForwardTestRepository, type ForwardTestConfig } from '../lib/forward-test/repository';
import { getDbPool } from '../lib/db/client';
import type { ClosedCandle, Fill } from '../lib/paper/types';

const scriptPath = fileURLToPath(import.meta.url);
const mode = process.argv[2];
const campaignKey = process.env.FORWARD_TEST_CAMPAIGN_KEY;
const testDbUrl = process.env.DATABASE_URL;
const repository = new ForwardTestRepository();

const config: ForwardTestConfig = {
  pairId: 'btcidr',
  timeframe: '60',
  initialEquity: '10000000',
  riskFraction: '0.01',
  makerRate: '0.001',
  takerRate: '0.001',
  taxRate: '0',
  taxVerified: false,
  feeSourceUrl: 'https://example.invalid/test-fees',
  feeEffectiveFrom: '2026-01-01T00:00:00.000Z',
  quantityIncrement: '0.00000001',
};

function closePool(): Promise<void> {
  return getDbPool().end();
}

function runProcess(args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), env, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Child process failed with status ${result.status ?? 'unknown'}.`);
}

async function seed(): Promise<void> {
  assert(campaignKey, 'FORWARD_TEST_CAMPAIGN_KEY required');
  const startedAt = Date.now() - 2 * 60 * 60_000;
  const run = await repository.ensureRun(config, startedAt);
  const processedAt = Date.now();
  const closeTimeMs = processedAt - 30 * 60_000;
  const candle: ClosedCandle = {
    pairId: 'btcidr', timeframe: '60', openTimeMs: closeTimeMs - 60 * 60_000, closeTimeMs,
    open: '10000', high: '10100', low: '9900', close: '10000', volume: '1', source: 'history_v2',
  };
  const decision = {
    idempotencyKey: `restart-proof:${campaignKey}:${closeTimeMs}`,
    strategyId: run.strategyId,
    pairId: run.pairId,
    candleCloseTimeMs: closeTimeMs,
    action: 'buy' as const,
    reasons: ['isolated database restart proof'],
    createdAtMs: processedAt,
  };
  const fill: Fill = {
    eventId: 'restart-proof-entry', pairId: run.pairId, side: 'buy', baseAmount: '0.1', quoteAmount: '1000',
    averagePrice: '10000', feeAmount: '1', taxAmount: '0', slippageBps: '0', source: 'rest-orderbook', occurredAtMs: processedAt,
  };
  const result = await repository.recordObservation({
    runId: run.id, candle, decision, processedAtMs: processedAt, fill, stopPrice: '9000', riskBudget: '100',
  });
  assert.equal(result.inserted, true);
  assert.equal(result.closedTrade, false);
  console.log('seed committed', JSON.stringify({ runId: run.id, accountId: run.accountId, closeTimeMs }));
  await closePool();
}

async function verifyAfterRestart(): Promise<void> {
  assert(campaignKey, 'FORWARD_TEST_CAMPAIGN_KEY required');
  const run = await repository.getRun();
  assert(run, 'run missing after process restart');
  const portfolio = await repository.getPortfolio(run);
  assert.equal(portfolio.cash, '9998999');
  assert.equal(portfolio.position?.baseAmount, '0.1');
  assert.equal(portfolio.position?.stopPrice, '9000');

  const stored = await getDbPool().query(
    `SELECT pair_id, timeframe, open_time_ms, close_time_ms, open_price, high_price, low_price, close_price, volume_base, source
     FROM forward_test_candles WHERE run_id=$1 ORDER BY close_time_ms`,
    [run.id],
  );
  assert.equal(stored.rowCount, 1);
  const row = stored.rows[0];
  const candle: ClosedCandle = {
    pairId: String(row.pair_id), timeframe: String(row.timeframe), openTimeMs: Number(row.open_time_ms), closeTimeMs: Number(row.close_time_ms),
    open: String(row.open_price), high: String(row.high_price), low: String(row.low_price), close: String(row.close_price), volume: String(row.volume_base), source: 'history_v2',
  };
  const duplicate = await repository.recordObservation({
    runId: run.id,
    candle,
    decision: {
      idempotencyKey: `restart-proof:${campaignKey}:${candle.closeTimeMs}`,
      strategyId: run.strategyId,
      pairId: run.pairId,
      candleCloseTimeMs: candle.closeTimeMs,
      action: 'buy',
      reasons: ['same decision replay after restart'],
      createdAtMs: Date.now(),
    },
    processedAtMs: Date.now(),
  });
  assert.deepEqual(duplicate, { inserted: false, closedTrade: false });

  const exitAt = Date.now();
  const exitFill: Fill = {
    eventId: 'restart-proof-exit', pairId: run.pairId, side: 'sell', baseAmount: '0.1', quoteAmount: '1100',
    averagePrice: '11000', feeAmount: '1.1', taxAmount: '0', slippageBps: '0', source: 'rest-orderbook', occurredAtMs: exitAt,
  };
  assert.equal(await repository.recordStopExit(run.id, exitFill, exitAt), true);
  assert.equal(await repository.recordStopExit(run.id, exitFill, exitAt + 60_000), false);

  const finalPortfolio = await repository.getPortfolio(run);
  assert.equal(finalPortfolio.cash, '10000097.9');
  assert.equal(finalPortfolio.position, null);
  const counts = await getDbPool().query(
    `SELECT
       (SELECT COUNT(*)::int FROM forward_test_candles WHERE run_id=$1) AS candles,
       (SELECT COUNT(*)::int FROM forward_test_events WHERE run_id=$1 AND event_kind='decision') AS decisions,
       (SELECT COUNT(*)::int FROM paper_orders WHERE account_id=$2) AS orders,
       (SELECT COUNT(*)::int FROM paper_fills pf JOIN paper_orders po ON po.id=pf.order_id WHERE po.account_id=$2) AS fills,
       (SELECT COUNT(*)::int FROM paper_cash_ledger WHERE run_id=$1) AS ledger,
       (SELECT COUNT(*)::int FROM closed_trades WHERE account_id=$2) AS trades`,
    [run.id, run.accountId],
  );
  assert.deepEqual(counts.rows[0], { candles: 1, decisions: 1, orders: 2, fills: 2, ledger: 3, trades: 1 });

  let appendOnlyRejected = false;
  try {
    await getDbPool().query("UPDATE forward_test_events SET payload_json='{}'::jsonb WHERE run_id=$1", [run.id]);
  } catch {
    appendOnlyRejected = true;
  }
  assert.equal(appendOnlyRejected, true);
  console.log('restart verify PASS', JSON.stringify({ runId: run.id, accountId: run.accountId, cash: finalPortfolio.cash, counts: counts.rows[0], duplicateDecisionIgnored: true, duplicateStopIgnored: true, appendOnlyRejected }));
  await closePool();
}

async function main(): Promise<void> {
  if (mode === 'seed') return seed();
  if (mode === 'verify') return verifyAfterRestart();

  if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a disposable local PostgreSQL database; production DATABASE_URL is intentionally not accepted.');
  const env = {
    ...process.env,
    NODE_ENV: 'test' as const,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    DATABASE_SSL: process.env.TEST_DATABASE_SSL ?? 'disable',
    FORWARD_TEST_CAMPAIGN_KEY: `restart-proof:${randomUUID()}`,
  };
  runProcess(['scripts/migrate.mjs'], env);
  const file = resolve(scriptPath);
  runProcess(['--import', 'tsx', file, 'seed'], env);
  runProcess(['--import', 'tsx', file, 'verify'], env);
  console.log('Forward-test DB proof passed across a real process restart.');
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack : 'Forward-test DB proof failed.');
  try { await closePool(); } catch { /* no pool may have been opened */ }
  process.exitCode = 1;
});
