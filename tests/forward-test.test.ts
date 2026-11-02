import { describe, expect, it } from 'vitest';
import { evaluateForwardTestEvidence, FORWARD_TEST_MIN_DURATION_MS, FORWARD_TEST_MIN_CANDLES } from '../lib/forward-test/criteria';
import { candleObservationIssue, shouldStartForwardTestWorker } from '../lib/forward-test/worker-guards';

const first = 1_800_000_000_000;
const now = first + FORWARD_TEST_MIN_DURATION_MS;
const base = {
  status: 'completed' as const,
  firstObservedCloseMs: first,
  lastProcessedCloseMs: now,
  observedCandles: FORWARD_TEST_MIN_CANDLES,
  gapCount: 0,
  lastHeartbeatAtMs: now,
  lastError: null,
  nowMs: now,
};

describe('forward-test eligibility', () => {
  it('passes only at 14 elapsed days with at least 337 contiguous observations', () => {
    expect(evaluateForwardTestEvidence(base).qualified).toBe(true);
    expect(evaluateForwardTestEvidence({ ...base, lastProcessedCloseMs: now - 60_000 }).qualified).toBe(false);
    expect(evaluateForwardTestEvidence({ ...base, observedCandles: FORWARD_TEST_MIN_CANDLES - 1 }).qualified).toBe(false);
  });

  it('rejects runs with gaps, errors, or invalidated status even after 14 days', () => {
    expect(evaluateForwardTestEvidence({ ...base, gapCount: 1 }).reasons).toContain('unresolved_candle_gaps');
    expect(evaluateForwardTestEvidence({ ...base, lastError: 'feed stale' }).reasons).toContain('unresolved_worker_error');
    expect(evaluateForwardTestEvidence({ ...base, status: 'invalidated' }).qualified).toBe(false);
  });

  it('requires a fresh heartbeat for an incomplete run', () => {
    const staleHeartbeat = { ...base, status: 'running' as const, lastHeartbeatAtMs: now - 5 * 60_000 - 1 };
    expect(evaluateForwardTestEvidence(staleHeartbeat).reasons).toContain('run_not_completed');
    expect(evaluateForwardTestEvidence(staleHeartbeat).reasons).toContain('heartbeat_stale');
  });
});

describe('forward-test worker lifecycle guards', () => {
  it('starts only on production Node runtime', () => {
    expect(shouldStartForwardTestWorker('nodejs', 'production')).toBe(true);
    expect(shouldStartForwardTestWorker('edge', 'production')).toBe(false);
    expect(shouldStartForwardTestWorker('nodejs', 'development')).toBe(false);
  });

  it('rejects backfill before run start and duplicate/old candle cursor values', () => {
    expect(candleObservationIssue({ lastProcessedCloseMs: 0, candleCloseMs: 100, runStartedAtMs: 100, nowMs: 200 })).toBe('historical_before_start');
    expect(candleObservationIssue({ lastProcessedCloseMs: 100, candleCloseMs: 100, runStartedAtMs: 0, nowMs: 200 })).toBe('duplicate_or_old');
  });

  it('invalidates a delayed observation and a missing hourly interval', () => {
    expect(candleObservationIssue({ lastProcessedCloseMs: 0, candleCloseMs: 1_000, runStartedAtMs: 0, nowMs: 1_000 + 15 * 60_000 + 1 })).toBe('candle_late');
    expect(candleObservationIssue({ lastProcessedCloseMs: 3_600_000, candleCloseMs: 7_320_001, runStartedAtMs: 0, nowMs: 7_320_001 })).toBe('candle_gap');
  });
});
