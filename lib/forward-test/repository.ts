import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db/client';
import { evaluateForwardTestEvidence } from './criteria';
import type { DecisionRecord } from '@/lib/paper/signals';
import type { ClosedCandle, Fill } from '@/lib/paper/types';

const D = (value: string | number) => new Decimal(value);
const numericString = (value: unknown) => D(String(value)).toFixed();
const CAMPAIGN_KEY = process.env.NODE_ENV === 'test' && process.env.FORWARD_TEST_CAMPAIGN_KEY
  ? process.env.FORWARD_TEST_CAMPAIGN_KEY
  : 'forward:v1:trend-following:btcidr:60';
const INITIAL_EQUITY = '10000000';
const STRATEGY_VERSION = '1.0.0';

export type ForwardTestRun = {
  id: string;
  campaignKey: string;
  accountId: string;
  strategyId: string;
  strategySlug: string;
  strategyVersion: string;
  pairId: string;
  timeframe: string;
  status: 'running' | 'paused' | 'invalidated' | 'completed';
  startedAtMs: number;
  firstObservedCloseMs: number | null;
  lastProcessedCloseMs: number;
  lastHeartbeatAtMs: number | null;
  observedCandles: number;
  gapCount: number;
  initialEquity: string;
  currentEquity: string;
  lastError: string | null;
  config: Record<string, unknown>;
};

export type ForwardTestConfig = {
  pairId: string;
  timeframe: string;
  initialEquity: string;
  riskFraction: string;
  makerRate: string;
  takerRate: string;
  taxRate: string;
  taxVerified: boolean;
  feeSourceUrl: string;
  feeEffectiveFrom: string;
  priceIncrement?: string;
  quantityIncrement?: string;
  minimumBase?: string;
  minimumQuote?: string;
};

export type ForwardPortfolio = {
  cash: string;
  position: null | {
    baseAmount: string;
    averageEntry: string;
    stopPrice: string | null;
    entryFillId: string | null;
    entryFee: string;
    entryTax: string;
    riskBudget: string;
    entryAtMs: number | null;
  };
  realizedPnl24h: string;
};

export type ForwardTestStatus = {
  runId: string;
  campaignKey: string;
  status: ForwardTestRun['status'];
  qualified: boolean;
  startedAtMs: number;
  firstObservedCloseMs: number | null;
  lastProcessedCloseMs: number;
  elapsedHours: number;
  requiredHours: number;
  observedCandles: number;
  requiredCandles: number;
  gapCount: number;
  heartbeatAgeSeconds: number | null;
  counts: { decisions: number; closed_trades: number; orders: number; fills: number };
  initialEquity: string;
  currentEquity: string;
  lastError: string | null;
  taxVerified: boolean;
  paperOnly: true;
  activationAllowed: false;
  reason: string;
};

export type ObservationInput = {
  runId: string;
  candle: ClosedCandle;
  decision: DecisionRecord;
  processedAtMs: number;
  fill?: Fill;
  stopPrice?: string;
  riskBudget?: string;
  riskBlock?: string;
};

function dateMs(value: Date | string | number | null): number | null {
  if (value === null) return null;
  const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function mapRun(row: Record<string, unknown>): ForwardTestRun {
  return {
    id: String(row.id),
    campaignKey: String(row.campaign_key),
    accountId: String(row.account_id),
    strategyId: String(row.strategy_id),
    strategySlug: String(row.strategy_slug),
    strategyVersion: String(row.strategy_version),
    pairId: String(row.pair_id),
    timeframe: String(row.timeframe),
    status: row.status as ForwardTestRun['status'],
    startedAtMs: dateMs(row.started_at as Date | string | number | null) ?? 0,
    firstObservedCloseMs: row.first_observed_close_ms === null ? null : Number(row.first_observed_close_ms),
    lastProcessedCloseMs: Number(row.last_processed_close_ms),
    lastHeartbeatAtMs: dateMs(row.last_heartbeat_at as Date | string | number | null),
    observedCandles: Number(row.observed_candles),
    gapCount: Number(row.gap_count),
    initialEquity: numericString(row.initial_equity),
    currentEquity: numericString(row.current_equity),
    lastError: row.last_error === null ? null : String(row.last_error),
    config: (row.config_json ?? {}) as Record<string, unknown>,
  };
}

async function appendEvent(
  client: PoolClient,
  input: { runId: string; key: string; kind: string; sourceEventTimeMs?: number | null; occurredAtMs: number; payload: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `INSERT INTO forward_test_events (id, run_id, idempotency_key, event_kind, source_event_time_ms, occurred_at_ms, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (run_id, idempotency_key) DO NOTHING`,
    [randomUUID(), input.runId, input.key, input.kind, input.sourceEventTimeMs ?? null, input.occurredAtMs, JSON.stringify(input.payload)],
  );
}

export class ForwardTestRepository {
  async ensureRun(config: ForwardTestConfig, startedAtMs = Date.now()): Promise<ForwardTestRun> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM forward_test_runs WHERE campaign_key = $1 FOR UPDATE', [CAMPAIGN_KEY]);
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return mapRun(existing.rows[0]);
      }

      const accountId = randomUUID();
      await client.query(
        `INSERT INTO virtual_accounts (id, name, initial_idr, cash_idr, status)
         VALUES ($1, 'Indo Signal forward-test paper-only', $2, $2, 'active')`,
        [accountId, config.initialEquity],
      );
      const strategyConfig = {
        marketType: 'spot-long-only',
        pairId: config.pairId,
        timeframe: config.timeframe,
        riskFraction: config.riskFraction,
        stop: '2x ATR; exits also on sell signal',
        source: 'closed-candle + fresh public orderbook; no real orders',
      };
      const generatedStrategyId = randomUUID();
      await client.query(
        `INSERT INTO strategies (id, slug, version, status, config_json)
         VALUES ($1, 'trend-following', $2, 'paper_test', $3::jsonb)
         ON CONFLICT (slug, version) DO NOTHING`,
        [generatedStrategyId, STRATEGY_VERSION, JSON.stringify(strategyConfig)],
      );
      const strategy = await client.query('SELECT id FROM strategies WHERE slug = $1 AND version = $2', ['trend-following', STRATEGY_VERSION]);
      const runId = randomUUID();
      const configSnapshot = {
        ...config,
        strategySlug: 'trend-following',
        strategyVersion: STRATEGY_VERSION,
        initialEquity: config.initialEquity,
        shortSelling: false,
        execution: 'paper-only; REST orderbook; all-or-none fill; no private API',
        taxNote: config.taxVerified ? 'verified' : 'unverified; shown pre-tax and activation blocked',
        startedAtMs,
      };
      const inserted = await client.query(
        `INSERT INTO forward_test_runs
         (id, campaign_key, account_id, strategy_id, strategy_slug, strategy_version, pair_id, timeframe,
          status, started_at, initial_equity, current_equity, config_json)
         VALUES ($1, $2, $3, $4, 'trend-following', $5, $6, $7, 'running', to_timestamp($8::double precision / 1000), $9, $9, $10::jsonb)
         RETURNING *`,
        [runId, CAMPAIGN_KEY, accountId, strategy.rows[0].id, STRATEGY_VERSION, config.pairId, config.timeframe, startedAtMs, config.initialEquity, JSON.stringify(configSnapshot)],
      );
      await client.query(
        `INSERT INTO fee_configs (id, pair_id, source_url, source_published_at, effective_from, maker_rate, taker_rate,
          tax_buy_rate, tax_sell_rate, assumptions_json)
         VALUES ($1, $2, $3, NULL, to_timestamp($4::double precision / 1000), $5, $6, $7, $7, $8::jsonb)`,
        [randomUUID(), config.pairId, config.feeSourceUrl, Date.parse(config.feeEffectiveFrom), config.makerRate, config.takerRate,
          config.taxVerified ? config.taxRate : null,
          JSON.stringify({ runId, taxVerified: config.taxVerified, appliedTaxRate: config.taxRate, note: config.taxVerified ? 'verified' : 'unverified; results are pre-tax' })],
      );
      await client.query(
        `INSERT INTO paper_cash_ledger (id, run_id, account_id, idempotency_key, event_kind, delta_cash, balance_after, source_payload)
         VALUES ($1, $2, $3, $4, 'virtual_deposit', $5, $5, $6::jsonb)`,
        [randomUUID(), runId, accountId, `${runId}:virtual-deposit`, config.initialEquity, JSON.stringify({ note: 'Virtual paper balance; no real funds.' })],
      );
      await appendEvent(client, {
        runId,
        key: `${runId}:started`,
        kind: 'run_started',
        occurredAtMs: startedAtMs,
        payload: { campaignKey: CAMPAIGN_KEY, config: configSnapshot, initialEquity: config.initialEquity },
      });
      await client.query('COMMIT');
      return mapRun(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRun(): Promise<ForwardTestRun | null> {
    const result = await getDbPool().query('SELECT * FROM forward_test_runs WHERE campaign_key = $1', [CAMPAIGN_KEY]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async getPortfolio(run: ForwardTestRun): Promise<ForwardPortfolio> {
    const client = await getDbPool().connect();
    try {
      const account = await client.query('SELECT cash_idr FROM virtual_accounts WHERE id = $1', [run.accountId]);
      const position = await client.query(
        `SELECT base_amount, average_entry, stop_price, entry_fill_id, entry_fee, entry_tax, risk_budget, entry_at
         FROM positions WHERE account_id = $1 AND strategy_id = $2 AND pair_id = $3 AND base_amount > 0`,
        [run.accountId, run.strategyId, run.pairId],
      );
      const realized = await client.query(
        `SELECT COALESCE(SUM(pnl_quote), 0)::text AS pnl
         FROM closed_trades WHERE account_id = $1 AND closed_at >= now() - interval '24 hours'`,
        [run.accountId],
      );
      const row = position.rows[0];
      return {
        cash: numericString(account.rows[0]?.cash_idr ?? '0'),
        position: row ? {
          baseAmount: numericString(row.base_amount),
          averageEntry: numericString(row.average_entry),
          stopPrice: row.stop_price === null ? null : numericString(row.stop_price),
          entryFillId: row.entry_fill_id === null ? null : String(row.entry_fill_id),
          entryFee: numericString(row.entry_fee),
          entryTax: numericString(row.entry_tax),
          riskBudget: numericString(row.risk_budget),
          entryAtMs: dateMs(row.entry_at),
        } : null,
        realizedPnl24h: numericString(realized.rows[0]?.pnl ?? '0'),
      };
    } finally {
      client.release();
    }
  }

  async heartbeat(runId: string, atMs = Date.now()): Promise<void> {
    await getDbPool().query(
      `UPDATE forward_test_runs SET last_heartbeat_at = to_timestamp($2::double precision / 1000), last_error = NULL, updated_at = now()
       WHERE id = $1 AND status = 'running'`,
      [runId, atMs],
    );
  }

  async recordStopExit(runId: string, fill: Fill, atMs = Date.now()): Promise<boolean> {
    if (fill.side !== 'sell') throw new Error('Stop-loss paper exit harus berupa sell spot.');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM forward_test_runs WHERE id = $1 FOR UPDATE', [runId]);
      if (!result.rows[0] || result.rows[0].status !== 'running') {
        await client.query('ROLLBACK');
        return false;
      }
      const run = mapRun(result.rows[0]);
      const position = await client.query(
        'SELECT base_amount, entry_fill_id, stop_price FROM positions WHERE account_id=$1 AND strategy_id=$2 AND pair_id=$3 FOR UPDATE',
        [run.accountId, run.strategyId, run.pairId],
      );
      if (!position.rows[0] || !D(String(position.rows[0].base_amount)).gt(0)) {
        await client.query('COMMIT');
        return false;
      }
      const entryFillId = String(position.rows[0].entry_fill_id ?? 'untracked');
      await appendEvent(client, {
        runId,
        key: `${runId}:stop-triggered:${entryFillId}`,
        kind: 'stop_triggered',
        sourceEventTimeMs: run.lastProcessedCloseMs,
        occurredAtMs: atMs,
        payload: { stopPrice: String(position.rows[0].stop_price ?? 'unknown'), entryFillId, exitFill: fill },
      });
      const outcome = await this.persistFill(client, run, fill, run.lastProcessedCloseMs, atMs);
      if (outcome.blockReason) {
        await appendEvent(client, {
          runId,
          key: `${runId}:stop-risk-block:${entryFillId}:${Math.floor(atMs / 60_000)}`,
          kind: 'risk_block',
          sourceEventTimeMs: run.lastProcessedCloseMs,
          occurredAtMs: atMs,
          payload: { reason: outcome.blockReason, event: 'stop_exit' },
        });
        await client.query('COMMIT');
        return false;
      }
      const account = await client.query('SELECT cash_idr FROM virtual_accounts WHERE id=$1', [run.accountId]);
      const completion = evaluateForwardTestEvidence({
        status: 'completed', firstObservedCloseMs: run.firstObservedCloseMs, lastProcessedCloseMs: run.lastProcessedCloseMs,
        observedCandles: run.observedCandles, gapCount: run.gapCount, lastHeartbeatAtMs: atMs, lastError: null, nowMs: atMs,
      });
      const finalStatus = completion.qualified ? 'completed' : 'running';
      await client.query(
        `UPDATE forward_test_runs SET current_equity=$2, status=$3::varchar,
         completed_at=CASE WHEN $3::varchar='completed' THEN now() ELSE completed_at END,
         last_error=NULL, last_heartbeat_at=to_timestamp($4::double precision / 1000), updated_at=now() WHERE id=$1`,
        [runId, String(account.rows[0].cash_idr), finalStatus, atMs],
      );
      await client.query('COMMIT');
      return outcome.closedTrade;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordWorkerError(runId: string, message: string, atMs = Date.now()): Promise<void> {
    await getDbPool().query(
      `UPDATE forward_test_runs SET last_error=$2, last_heartbeat_at=to_timestamp($3::double precision / 1000), updated_at=now()
       WHERE id=$1 AND status='running'`,
      [runId, message.slice(0, 500), atMs],
    );
  }

  async invalidate(runId: string, reason: string, atMs = Date.now(), sourceCloseMs?: number): Promise<void> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE forward_test_runs SET status = 'invalidated', gap_count = gap_count + 1, last_error = $2,
         last_heartbeat_at = to_timestamp($3::double precision / 1000), updated_at = now() WHERE id = $1 AND status = 'running' RETURNING id`,
        [runId, reason, atMs],
      );
      if (updated.rowCount) {
        await appendEvent(client, {
          runId,
          key: `${runId}:invalidated:${sourceCloseMs ?? atMs}`,
          kind: 'run_invalidated',
          sourceEventTimeMs: sourceCloseMs,
          occurredAtMs: atMs,
          payload: { reason },
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordObservation(input: ObservationInput): Promise<{ inserted: boolean; closedTrade: boolean }> {
    const { runId, candle, decision, processedAtMs, fill, stopPrice, riskBudget, riskBlock } = input;
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const runResult = await client.query('SELECT * FROM forward_test_runs WHERE id = $1 FOR UPDATE', [runId]);
      if (!runResult.rows[0] || runResult.rows[0].status !== 'running') {
        await client.query('ROLLBACK');
        return { inserted: false, closedTrade: false };
      }
      const run = mapRun(runResult.rows[0]);
      if (candle.closeTimeMs <= run.lastProcessedCloseMs || candle.closeTimeMs <= run.startedAtMs) {
        await client.query('COMMIT');
        return { inserted: false, closedTrade: false };
      }
      if (candle.source !== 'history_v2' || candle.closeTimeMs > processedAtMs || candle.closeTimeMs <= candle.openTimeMs) {
        throw new Error('Candle forward-test tidak memenuhi kontrak closed-only/source.');
      }

      const candleInserted = await client.query(
        `INSERT INTO forward_test_candles
         (run_id, pair_id, timeframe, open_time_ms, close_time_ms, open_price, high_price, low_price, close_price, volume_base, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (run_id, pair_id, timeframe, close_time_ms) DO NOTHING RETURNING close_time_ms`,
        [runId, candle.pairId, candle.timeframe, candle.openTimeMs, candle.closeTimeMs, String(candle.open), String(candle.high), String(candle.low), String(candle.close), String(candle.volume), candle.source],
      );
      if (!candleInserted.rowCount) {
        await client.query('COMMIT');
        return { inserted: false, closedTrade: false };
      }

      const decisionId = randomUUID();
      await client.query(
        `INSERT INTO decision_log (id, account_id, strategy_id, pair_id, candle_close_time_ms, action, reason_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (strategy_id, pair_id, candle_close_time_ms) DO NOTHING`,
        [decisionId, run.accountId, run.strategyId, run.pairId, candle.closeTimeMs, decision.action, JSON.stringify(decision.reasons)],
      );
      await appendEvent(client, {
        runId,
        key: `${runId}:decision:${candle.closeTimeMs}`,
        kind: 'decision',
        sourceEventTimeMs: candle.closeTimeMs,
        occurredAtMs: processedAtMs,
        payload: { action: decision.action, reasons: decision.reasons, candleCloseTimeMs: candle.closeTimeMs },
      });

      let closedTrade = false;
      if (riskBlock) {
        await appendEvent(client, {
          runId,
          key: `${runId}:risk-block:${candle.closeTimeMs}`,
          kind: 'risk_block',
          sourceEventTimeMs: candle.closeTimeMs,
          occurredAtMs: processedAtMs,
          payload: { reason: riskBlock, action: decision.action },
        });
      }

      if (fill) {
        const outcome = await this.persistFill(client, run, fill, candle.closeTimeMs, processedAtMs, stopPrice, riskBudget);
        closedTrade = outcome.closedTrade;
        if (outcome.blockReason) {
          await appendEvent(client, {
            runId,
            key: `${runId}:risk-block:${candle.closeTimeMs}`,
            kind: 'risk_block',
            sourceEventTimeMs: candle.closeTimeMs,
            occurredAtMs: processedAtMs,
            payload: { reason: outcome.blockReason, action: decision.action },
          });
        }
      }

      const previousClose = run.lastProcessedCloseMs || null;
      const observedCandles = run.observedCandles + 1;
      const firstClose = run.firstObservedCloseMs ?? candle.closeTimeMs;
      const candidateEvidence = evaluateForwardTestEvidence({
        status: 'completed', firstObservedCloseMs: firstClose, lastProcessedCloseMs: candle.closeTimeMs,
        observedCandles, gapCount: run.gapCount, lastHeartbeatAtMs: processedAtMs, lastError: null, nowMs: processedAtMs,
      });
      const portfolio = await client.query('SELECT cash_idr FROM virtual_accounts WHERE id = $1', [run.accountId]);
      const openPosition = await client.query(
        'SELECT base_amount FROM positions WHERE account_id = $1 AND strategy_id = $2 AND pair_id = $3',
        [run.accountId, run.strategyId, run.pairId],
      );
      const finalStatus = !openPosition.rows[0] && candidateEvidence.qualified ? 'completed' : 'running';
      let currentEquity = D(portfolio.rows[0].cash_idr);
      if (openPosition.rows[0]) currentEquity = currentEquity.add(D(openPosition.rows[0].base_amount).mul(D(String(candle.close))));
      await client.query(
        `UPDATE forward_test_runs SET first_observed_close_ms = COALESCE(first_observed_close_ms, $2),
         last_processed_close_ms = $2, observed_candles = observed_candles + 1,
         current_equity = $3, status = $4::varchar,
         completed_at = CASE WHEN $4::varchar = 'completed' THEN now() ELSE completed_at END,
         last_heartbeat_at = to_timestamp($5::double precision / 1000), last_error = NULL, updated_at = now()
         WHERE id = $1`,
        [runId, candle.closeTimeMs, currentEquity.toFixed(), finalStatus, processedAtMs],
      );
      await appendEvent(client, {
        runId,
        key: `${runId}:candle:${candle.closeTimeMs}`,
        kind: 'candle_observed',
        sourceEventTimeMs: candle.closeTimeMs,
        occurredAtMs: processedAtMs,
        payload: { previousCloseMs: previousClose, observedCandles, currentEquity: currentEquity.toFixed(), status: finalStatus },
      });
      await client.query('COMMIT');
      return { inserted: true, closedTrade };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistFill(
    client: PoolClient,
    run: ForwardTestRun,
    fill: Fill,
    closeTimeMs: number,
    processedAtMs: number,
    stopPrice?: string,
    riskBudget?: string,
  ): Promise<{ closedTrade: boolean; blockReason?: string }> {
    const account = await client.query('SELECT cash_idr FROM virtual_accounts WHERE id = $1 FOR UPDATE', [run.accountId]);
    const positionResult = await client.query(
      `SELECT base_amount, average_entry, entry_fill_id, entry_fee, entry_tax, risk_budget
       FROM positions WHERE account_id = $1 AND strategy_id = $2 AND pair_id = $3 FOR UPDATE`,
      [run.accountId, run.strategyId, run.pairId],
    );
    const position = positionResult.rows[0];
    const cash = D(String(account.rows[0]?.cash_idr ?? '0'));
    const gross = D(fill.quoteAmount);
    const feeAndTax = D(fill.feeAmount).add(fill.taxAmount);
    const eventKey = `${runIdKey(run)}:${closeTimeMs}:${fill.side}`;
    const orderId = randomUUID();
    const fillId = randomUUID();

    if (fill.side === 'buy') {
      if (position && D(String(position.base_amount)).gt(0)) return { closedTrade: false, blockReason: 'position_already_open' };
      const totalCost = gross.add(feeAndTax);
      if (totalCost.gt(cash)) return { closedTrade: false, blockReason: 'insufficient_virtual_cash' };
      if (!stopPrice || !riskBudget || D(riskBudget).lte(0)) return { closedTrade: false, blockReason: 'missing_risk_snapshot' };
      const orderKey = `${eventKey}:order`;
      await client.query(
        `INSERT INTO paper_orders (id, account_id, strategy_id, pair_id, side, order_type, requested_base, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'buy', 'market', $5, 'filled', $6)`,
        [orderId, run.accountId, run.strategyId, run.pairId, fill.baseAmount, orderKey],
      );
      await this.insertFill(client, orderId, fillId, fill, `${eventKey}:fill`);
      const newCash = cash.sub(totalCost);
      await client.query('UPDATE virtual_accounts SET cash_idr = $2, updated_at = now() WHERE id = $1', [run.accountId, newCash.toFixed()]);
      await client.query(
        `INSERT INTO paper_cash_ledger (id, run_id, account_id, idempotency_key, event_kind, delta_cash, balance_after, source_payload)
         VALUES ($1, $2, $3, $4, 'buy_fill', $5, $6, $7::jsonb)`,
        [randomUUID(), run.id, run.accountId, `${eventKey}:ledger`, totalCost.neg().toFixed(), newCash.toFixed(), JSON.stringify({ orderId, fillId, quote: fill.quoteAmount, fee: fill.feeAmount, tax: fill.taxAmount })],
      );
      await client.query(
        `INSERT INTO positions (account_id, strategy_id, pair_id, base_amount, average_entry, stop_price,
          realized_pnl, entry_fill_id, entry_fee, entry_tax, risk_budget, entry_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, to_timestamp($11::double precision / 1000))
         ON CONFLICT (account_id, strategy_id, pair_id) DO UPDATE SET base_amount=EXCLUDED.base_amount,
          average_entry=EXCLUDED.average_entry, stop_price=EXCLUDED.stop_price, realized_pnl=0,
          entry_fill_id=EXCLUDED.entry_fill_id, entry_fee=EXCLUDED.entry_fee, entry_tax=EXCLUDED.entry_tax,
          risk_budget=EXCLUDED.risk_budget, entry_at=EXCLUDED.entry_at, updated_at=now()`,
        [run.accountId, run.strategyId, run.pairId, fill.baseAmount, fill.averagePrice, stopPrice, fillId, fill.feeAmount, fill.taxAmount, riskBudget, fill.occurredAtMs],
      );
      await appendEvent(client, { runId: run.id, key: `${eventKey}:order-event`, kind: 'order_created', sourceEventTimeMs: closeTimeMs, occurredAtMs: processedAtMs, payload: { side: 'buy', orderId, fillId, requestedBase: fill.baseAmount } });
      await appendEvent(client, { runId: run.id, key: `${eventKey}:fill-event`, kind: 'fill', sourceEventTimeMs: closeTimeMs, occurredAtMs: fill.occurredAtMs, payload: { orderId, fillId, ...fill } });
      await appendEvent(client, { runId: run.id, key: `${eventKey}:position-event`, kind: 'position_opened', sourceEventTimeMs: closeTimeMs, occurredAtMs: fill.occurredAtMs, payload: { baseAmount: fill.baseAmount, averageEntry: fill.averagePrice, stopPrice, riskBudget } });
      return { closedTrade: false };
    }

    if (!position || !D(String(position.base_amount)).gt(0)) return { closedTrade: false, blockReason: 'no_open_spot_position' };
    if (!D(fill.baseAmount).eq(String(position.base_amount))) return { closedTrade: false, blockReason: 'partial_fill_not_supported' };
    const orderKey = `${eventKey}:order`;
    await client.query(
      `INSERT INTO paper_orders (id, account_id, strategy_id, pair_id, side, order_type, requested_base, status, idempotency_key)
       VALUES ($1, $2, $3, $4, 'sell', 'market', $5, 'filled', $6)`,
      [orderId, run.accountId, run.strategyId, run.pairId, fill.baseAmount, orderKey],
    );
    await this.insertFill(client, orderId, fillId, fill, `${eventKey}:fill`);
    const netProceeds = gross.sub(feeAndTax);
    const newCash = cash.add(netProceeds);
    const entryCost = D(String(position.average_entry)).mul(fill.baseAmount).add(position.entry_fee).add(position.entry_tax);
    const pnl = netProceeds.sub(entryCost);
    const budget = D(String(position.risk_budget ?? '0'));
    const pnlR = budget.gt(0) ? pnl.div(budget) : new Decimal(0);
    await client.query('UPDATE virtual_accounts SET cash_idr = $2, updated_at = now() WHERE id = $1', [run.accountId, newCash.toFixed()]);
    await client.query(
      `INSERT INTO paper_cash_ledger (id, run_id, account_id, idempotency_key, event_kind, delta_cash, balance_after, source_payload)
       VALUES ($1, $2, $3, $4, 'sell_fill', $5, $6, $7::jsonb)`,
      [randomUUID(), run.id, run.accountId, `${eventKey}:ledger`, netProceeds.toFixed(), newCash.toFixed(), JSON.stringify({ orderId, fillId, quote: fill.quoteAmount, fee: fill.feeAmount, tax: fill.taxAmount })],
    );
    await client.query(
      `INSERT INTO closed_trades (id, account_id, strategy_id, pair_id, entry_fill_id, exit_fill_id, base_amount,
        entry_price, exit_price, pnl_quote, pnl_r, closed_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12::double precision / 1000), $13)`,
      [randomUUID(), run.accountId, run.strategyId, run.pairId, position.entry_fill_id, fillId, fill.baseAmount, position.average_entry, fill.averagePrice, pnl.toFixed(), pnlR.toFixed(), fill.occurredAtMs, `${eventKey}:closed-trade`],
    );
    await client.query('DELETE FROM positions WHERE account_id=$1 AND strategy_id=$2 AND pair_id=$3', [run.accountId, run.strategyId, run.pairId]);
    await appendEvent(client, { runId: run.id, key: `${eventKey}:order-event`, kind: 'order_created', sourceEventTimeMs: closeTimeMs, occurredAtMs: processedAtMs, payload: { side: 'sell', orderId, fillId, requestedBase: fill.baseAmount } });
    await appendEvent(client, { runId: run.id, key: `${eventKey}:fill-event`, kind: 'fill', sourceEventTimeMs: closeTimeMs, occurredAtMs: fill.occurredAtMs, payload: { orderId, fillId, ...fill } });
    await appendEvent(client, { runId: run.id, key: `${eventKey}:closed-trade`, kind: 'position_closed', sourceEventTimeMs: closeTimeMs, occurredAtMs: fill.occurredAtMs, payload: { fillId, pnlQuote: pnl.toFixed(), pnlR: pnlR.toFixed(), equityAfter: newCash.toFixed() } });
    return { closedTrade: true };
  }

  private async insertFill(
    client: PoolClient,
    orderId: string,
    fillId: string,
    fill: Fill,
    eventId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO paper_fills (id, order_id, event_id, base_amount, quote_amount, average_price, fee_amount, tax_amount,
        slippage_bps, source, filled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11::double precision / 1000))`,
      [fillId, orderId, eventId, fill.baseAmount, fill.quoteAmount, fill.averagePrice, fill.feeAmount, fill.taxAmount, fill.slippageBps, fill.source, fill.occurredAtMs],
    );
  }

  async getStatus(): Promise<ForwardTestStatus | null> {
    const run = await this.getRun();
    if (!run) return null;
    const evidence = evaluateForwardTestEvidence({
      status: run.status,
      firstObservedCloseMs: run.firstObservedCloseMs,
      lastProcessedCloseMs: run.lastProcessedCloseMs,
      observedCandles: run.observedCandles,
      gapCount: run.gapCount,
      lastHeartbeatAtMs: run.lastHeartbeatAtMs,
      lastError: run.lastError,
      nowMs: Date.now(),
    });
    const elapsedMs = evidence.elapsedMs;
    const heartbeatAgeMs = run.lastHeartbeatAtMs === null ? null : Math.max(0, Date.now() - run.lastHeartbeatAtMs);
    const qualified = evidence.qualified;
    const counts = await getDbPool().query(
      `SELECT
         (SELECT COUNT(*)::int FROM forward_test_events WHERE run_id=$1 AND event_kind='decision') AS decisions,
         (SELECT COUNT(*)::int FROM closed_trades WHERE account_id=$2) AS closed_trades,
         (SELECT COUNT(*)::int FROM paper_orders WHERE account_id=$2) AS orders,
         (SELECT COUNT(*)::int FROM paper_fills pf JOIN paper_orders po ON po.id=pf.order_id WHERE po.account_id=$2) AS fills`,
      [run.id, run.accountId],
    );
    return {
      runId: run.id,
      campaignKey: run.campaignKey,
      status: run.status,
      qualified,
      startedAtMs: run.startedAtMs,
      firstObservedCloseMs: run.firstObservedCloseMs,
      lastProcessedCloseMs: run.lastProcessedCloseMs,
      elapsedHours: Number((elapsedMs / 3_600_000).toFixed(2)),
      requiredHours: 336,
      observedCandles: run.observedCandles,
      requiredCandles: 337,
      gapCount: run.gapCount,
      heartbeatAgeSeconds: heartbeatAgeMs === null ? null : Math.floor(heartbeatAgeMs / 1000),
      counts: counts.rows[0],
      initialEquity: run.initialEquity,
      currentEquity: run.currentEquity,
      lastError: run.lastError,
      taxVerified: run.config.taxVerified === true,
      paperOnly: true,
      activationAllowed: false,
      reason: qualified ? 'Forward-test selesai; tetap perlu review OOS, pajak/fee, dan persetujuan manual.' : 'Forward-test 14 hari dengan cakupan berurutan belum memenuhi syarat.',
    };
  }
}

function runIdKey(run: ForwardTestRun): string {
  return run.id;
}
