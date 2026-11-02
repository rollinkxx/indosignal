import { randomUUID } from 'node:crypto';
import { getDbPool } from '@/lib/db/client';

export const MULTI_PAIR_CAMPAIGN_KEY = 'scan:v1:trend-following:top-idr-20:60';
export const MULTI_PAIR_TIMEFRAME = '60';
const CANDLE_MS = 60 * 60_000;

type PairSnapshot = {
  pairId: string;
  tickerId: string;
  symbol: string;
  takerFeePercent: string;
  makerFeePercent: string;
  priceIncrement?: string;
  quantityIncrement?: string;
  minimumBase?: string;
  minimumQuote?: string;
  volumeIdr24h: string;
  spreadBps: number;
};

export type MultiPairUniverse = {
  strategySlug: 'trend-following';
  strategyVersion: '1.0.0';
  timeframe: '60';
  scanOnly: true;
  maxPairs: number;
  minimumVolumeIdr24h: string;
  maximumSpreadBps: number;
  pairs: PairSnapshot[];
};

export type MultiPairScanRun = {
  id: string;
  campaignKey: string;
  status: 'running' | 'paused' | 'invalidated';
  startedAtMs: number;
  lastHeartbeatAtMs: number | null;
  gapCount: number;
  lastError: string | null;
  universe: MultiPairUniverse;
};

function timestampMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === 'number' ? value : new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRun(row: Record<string, unknown>): MultiPairScanRun {
  const heartbeat = timestampMs(row.last_heartbeat_at);
  return {
    id: String(row.id),
    campaignKey: String(row.campaign_key),
    status: row.status as MultiPairScanRun['status'],
    startedAtMs: timestampMs(row.started_at) ?? 0,
    lastHeartbeatAtMs: heartbeat,
    gapCount: Number(row.gap_count),
    lastError: row.last_error === null ? null : String(row.last_error),
    universe: row.universe_json as MultiPairUniverse,
  };
}

export class MultiPairScanRepository {
  constructor(private readonly campaignKey = MULTI_PAIR_CAMPAIGN_KEY) {}

  async getRun(): Promise<MultiPairScanRun | null> {
    const result = await getDbPool().query('SELECT * FROM multi_pair_scan_runs WHERE campaign_key=$1', [this.campaignKey]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async ensureRun(universe: MultiPairUniverse, startedAtMs = Date.now()): Promise<MultiPairScanRun> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM multi_pair_scan_runs WHERE campaign_key=$1 FOR UPDATE', [this.campaignKey]);
      if (current.rows[0]) {
        await client.query('COMMIT');
        return mapRun(current.rows[0]);
      }
      const result = await client.query(
        `INSERT INTO multi_pair_scan_runs (id,campaign_key,status,started_at,last_heartbeat_at,universe_json,timeframe)
         VALUES ($1,$2,'running',to_timestamp($3::double precision/1000),to_timestamp($3::double precision/1000),$4::jsonb,$5)
         RETURNING *`,
        [randomUUID(), this.campaignKey, startedAtMs, JSON.stringify(universe), MULTI_PAIR_TIMEFRAME],
      );
      await client.query('COMMIT');
      return mapRun(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(runId: string, atMs = Date.now()): Promise<void> {
    await getDbPool().query(
      `UPDATE multi_pair_scan_runs SET last_heartbeat_at=to_timestamp($2::double precision/1000),last_error=NULL,updated_at=now()
       WHERE id=$1 AND status='running'`,
      [runId, atMs],
    );
  }

  async recordError(runId: string, message: string, atMs = Date.now()): Promise<void> {
    await getDbPool().query(
      `UPDATE multi_pair_scan_runs SET last_heartbeat_at=to_timestamp($2::double precision/1000),last_error=$3,updated_at=now()
       WHERE id=$1 AND status='running'`,
      [runId, atMs, message.slice(0, 500)],
    );
  }

  async latestClose(runId: string, pairId: string): Promise<number> {
    const result = await getDbPool().query(
      'SELECT MAX(close_time_ms)::text AS close_ms FROM multi_pair_scan_observations WHERE run_id=$1 AND pair_id=$2',
      [runId, pairId],
    );
    return result.rows[0]?.close_ms === null ? 0 : Number(result.rows[0].close_ms);
  }

  async recordObservation(input: {
    runId: string;
    pairId: string;
    timeframe: string;
    openTimeMs: number;
    closeTimeMs: number;
    action: 'buy' | 'sell' | 'hold';
    reasons: string[];
    candle: Record<string, unknown>;
    market: Record<string, unknown>;
    observedAtMs: number;
  }): Promise<{ inserted: boolean; gap: boolean }> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const prev = await client.query(
        'SELECT MAX(close_time_ms)::text AS close_ms FROM multi_pair_scan_observations WHERE run_id=$1 AND pair_id=$2',
        [input.runId, input.pairId],
      );
      const previousCloseMs = prev.rows[0]?.close_ms === null ? 0 : Number(prev.rows[0].close_ms);
      const gap = previousCloseMs > 0 && input.closeTimeMs - previousCloseMs > CANDLE_MS + 120_000;
      const inserted = await client.query(
        `INSERT INTO multi_pair_scan_observations
         (run_id,pair_id,timeframe,open_time_ms,close_time_ms,action,reasons_json,candle_json,market_json,observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,to_timestamp($10::double precision/1000))
         ON CONFLICT (run_id,pair_id,timeframe,close_time_ms) DO NOTHING RETURNING close_time_ms`,
        [input.runId,input.pairId,input.timeframe,input.openTimeMs,input.closeTimeMs,input.action,JSON.stringify(input.reasons),JSON.stringify(input.candle),JSON.stringify(input.market),input.observedAtMs],
      );
      if (inserted.rowCount && gap) {
        await client.query('UPDATE multi_pair_scan_runs SET gap_count=gap_count+1,updated_at=now() WHERE id=$1', [input.runId]);
      }
      await client.query('COMMIT');
      return { inserted: Boolean(inserted.rowCount), gap };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getStatus(): Promise<Record<string, unknown> | null> {
    const run = await this.getRun();
    if (!run) return null;
    const [summary, pairs] = await Promise.all([
      getDbPool().query(
        `SELECT COUNT(*)::int AS observations,
                MIN(close_time_ms)::text AS first_close_ms,
                MAX(close_time_ms)::text AS last_close_ms,
                COUNT(*) FILTER (WHERE action='buy')::int AS buy_signals,
                COUNT(*) FILTER (WHERE action='sell')::int AS sell_signals
         FROM multi_pair_scan_observations WHERE run_id=$1`,
        [run.id],
      ),
      getDbPool().query(
        `SELECT pair_id,COUNT(*)::int AS observed_candles,MIN(close_time_ms)::text AS first_close_ms,
                MAX(close_time_ms)::text AS last_close_ms,
                (ARRAY_AGG(action ORDER BY close_time_ms DESC))[1] AS last_action,
                (ARRAY_AGG(reasons_json ORDER BY close_time_ms DESC))[1] AS last_reasons
         FROM multi_pair_scan_observations WHERE run_id=$1 GROUP BY pair_id ORDER BY pair_id`,
        [run.id],
      ),
    ]);
    const heartbeatAge = run.lastHeartbeatAtMs === null ? null : Math.max(0, Math.floor((Date.now() - run.lastHeartbeatAtMs) / 1000));
    const pairProgress = run.universe.pairs.map((pair) => {
      const row = pairs.rows.find((candidate) => candidate.pair_id === pair.pairId);
      const first = row?.first_close_ms ? Number(row.first_close_ms) : null;
      const last = row?.last_close_ms ? Number(row.last_close_ms) : null;
      return {
        pairId: pair.pairId,
        symbol: pair.symbol,
        volumeIdr24h: pair.volumeIdr24h,
        observations: row?.observed_candles ?? 0,
        firstObservedCloseMs: first,
        lastObservedCloseMs: last,
        elapsedHours: first !== null && last !== null ? Number(((last - first) / 3_600_000).toFixed(2)) : 0,
        lastAction: row?.last_action ?? null,
        lastReasons: row?.last_reasons ?? [],
      };
    });
    return {
      campaignKey: run.campaignKey,
      runId: run.id,
      status: run.status,
      scanOnly: true,
      paperOrdersCreated: false,
      startedAtMs: run.startedAtMs,
      heartbeatAgeSeconds: heartbeatAge,
      lastError: run.lastError,
      gapCount: run.gapCount,
      filters: {
        maxPairs: run.universe.maxPairs,
        minimumVolumeIdr24h: run.universe.minimumVolumeIdr24h,
        maximumSpreadBps: run.universe.maximumSpreadBps,
        timeframe: run.universe.timeframe,
      },
      universe: run.universe.pairs.map(({ pairId, symbol, tickerId, volumeIdr24h, spreadBps }) => ({ pairId, symbol, tickerId, volumeIdr24h, spreadBps })),
      totals: summary.rows[0],
      pairProgress,
      requiredHoursForForwardReview: 336,
      activationAllowed: false,
    };
  }
}
