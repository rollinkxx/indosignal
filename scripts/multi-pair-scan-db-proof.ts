import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MultiPairScanRepository, type MultiPairUniverse } from '../lib/forward-test/multi-pair-repository';
import { getDbPool } from '../lib/db/client';

const scriptPath = fileURLToPath(import.meta.url);
const mode = process.argv[2];
const campaignKey = process.env.MULTI_PAIR_PROOF_CAMPAIGN_KEY;
const repository = new MultiPairScanRepository(campaignKey);
const universe: MultiPairUniverse = {
  strategySlug: 'trend-following', strategyVersion: '1.0.0', timeframe: '60', scanOnly: true,
  maxPairs: 20, minimumVolumeIdr24h: '100000000', maximumSpreadBps: 150,
  pairs: [{ pairId: 'btcidr', tickerId: 'BTC_IDR', symbol: 'BTC/IDR', takerFeePercent: '0.3', makerFeePercent: '0.2', volumeIdr24h: '500000000', spreadBps: 10 }],
};

async function closePool(): Promise<void> { await getDbPool().end(); }
function runProcess(args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), env, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Child process failed with status ${result.status ?? 'unknown'}.`);
}

async function seed(): Promise<void> {
  assert(campaignKey, 'MULTI_PAIR_PROOF_CAMPAIGN_KEY required');
  const snapshots = await getDbPool().query(`SELECT (SELECT COUNT(*)::int FROM virtual_accounts) AS accounts,(SELECT COUNT(*)::int FROM paper_orders) AS orders`);
  const startedAt = Date.now() - 10 * 60 * 60_000;
  const run = await repository.ensureRun(universe, startedAt);
  const firstClose = startedAt + 60 * 60_000;
  const input = {
    runId: run.id, pairId: 'btcidr', timeframe: '60', openTimeMs: firstClose - 60 * 60_000, closeTimeMs: firstClose,
    action: 'buy' as const, reasons: ['isolated multi-pair scan proof'], candle: { close: '100', volume: '2' },
    market: { spreadBps: 10 }, observedAtMs: Date.now(),
  };
  assert.deepEqual(await repository.recordObservation(input), { inserted: true, gap: false });
  const second = { ...input, openTimeMs: firstClose + 60 * 60_000, closeTimeMs: firstClose + 2 * 60 * 60_000, action: 'hold' as const };
  assert.deepEqual(await repository.recordObservation(second), { inserted: true, gap: true });
  const after = await getDbPool().query(`SELECT (SELECT COUNT(*)::int FROM virtual_accounts) AS accounts,(SELECT COUNT(*)::int FROM paper_orders) AS orders`);
  assert.deepEqual(after.rows[0], snapshots.rows[0], 'scanner must not create a virtual account or paper order');
  console.log('seed committed', JSON.stringify({ runId: run.id, campaignKey, firstClose, gapClose: second.closeTimeMs, noAccountOrOrder: true }));
  await closePool();
}

async function verifyAfterRestart(): Promise<void> {
  assert(campaignKey, 'MULTI_PAIR_PROOF_CAMPAIGN_KEY required');
  const run = await repository.getRun();
  assert(run, 'scan run missing after process restart');
  assert.equal(run.universe.scanOnly, true);
  assert.deepEqual(run.universe.pairs.map((pair) => pair.pairId), ['btcidr']);
  assert.equal(run.gapCount, 1);
  const replay = await repository.recordObservation({
    runId: run.id, pairId: 'btcidr', timeframe: '60', openTimeMs: run.startedAtMs,
    closeTimeMs: run.startedAtMs + 3 * 60 * 60_000, action: 'hold', reasons: ['replay'], candle: { close: '100' }, market: {}, observedAtMs: Date.now(),
  });
  assert.deepEqual(replay, { inserted: false, gap: false });
  const status = await repository.getStatus();
  assert(status);
  assert.equal(status.scanOnly, true);
  assert.equal(status.paperOrdersCreated, false);
  assert.equal((status.totals as { observations: number }).observations, 2);
  assert.equal((status.pairProgress as Array<{ observations: number }>)[0].observations, 2);

  let appendOnlyRejected = false;
  try {
    await getDbPool().query("UPDATE multi_pair_scan_observations SET reasons_json='[]'::jsonb WHERE run_id=$1", [run.id]);
  } catch { appendOnlyRejected = true; }
  assert.equal(appendOnlyRejected, true);
  console.log('multi-pair scan DB proof PASS', JSON.stringify({ runId: run.id, observations: (status.totals as { observations: number }).observations, gapCount: run.gapCount, scanOnly: status.scanOnly, paperOrdersCreated: status.paperOrdersCreated, appendOnlyRejected }));
  await closePool();
}

async function main(): Promise<void> {
  if (mode === 'seed') return seed();
  if (mode === 'verify') return verifyAfterRestart();
  const testDbUrl = process.env.TEST_DATABASE_URL;
  if (!testDbUrl) throw new Error('Set TEST_DATABASE_URL to a disposable local PostgreSQL database; production DATABASE_URL is intentionally not accepted.');
  const env = { ...process.env, NODE_ENV: 'test' as const, DATABASE_URL: testDbUrl, DATABASE_SSL: process.env.TEST_DATABASE_SSL ?? 'disable', MULTI_PAIR_PROOF_CAMPAIGN_KEY: `multi-pair-proof:${randomUUID()}` };
  runProcess(['scripts/migrate.mjs'], env);
  runProcess(['--import', 'tsx', resolve(scriptPath), 'seed'], env);
  runProcess(['--import', 'tsx', resolve(scriptPath), 'verify'], env);
  console.log('Multi-pair scan DB proof passed across a real process restart.');
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack : 'Multi-pair scan DB proof failed.');
  try { await closePool(); } catch { /* pool might not be initialized */ }
  process.exitCode = 1;
});
