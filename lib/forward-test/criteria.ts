export const FORWARD_TEST_MIN_HOURS = 14 * 24;
export const FORWARD_TEST_MIN_CANDLES = FORWARD_TEST_MIN_HOURS + 1;
export const FORWARD_TEST_HEARTBEAT_MAX_AGE_MS = 5 * 60_000;
export const FORWARD_TEST_MIN_DURATION_MS = FORWARD_TEST_MIN_HOURS * 60 * 60_000;

export type ForwardTestEvidenceInput = {
  status: 'running' | 'paused' | 'invalidated' | 'completed';
  firstObservedCloseMs: number | null;
  lastProcessedCloseMs: number;
  observedCandles: number;
  gapCount: number;
  lastHeartbeatAtMs: number | null;
  lastError: string | null;
  nowMs: number;
};

export function evaluateForwardTestEvidence(input: ForwardTestEvidenceInput): {
  qualified: boolean;
  elapsedMs: number;
  reasons: string[];
} {
  const elapsedMs = input.firstObservedCloseMs === null
    ? 0
    : Math.max(0, input.lastProcessedCloseMs - input.firstObservedCloseMs);
  const heartbeatAge = input.lastHeartbeatAtMs === null ? Number.POSITIVE_INFINITY : Math.max(0, input.nowMs - input.lastHeartbeatAtMs);
  const reasons: string[] = [];
  if (input.status !== 'completed') reasons.push('run_not_completed');
  if (elapsedMs < FORWARD_TEST_MIN_DURATION_MS) reasons.push('duration_under_14_days');
  if (input.observedCandles < FORWARD_TEST_MIN_CANDLES) reasons.push('coverage_under_337_candles');
  if (input.gapCount !== 0) reasons.push('unresolved_candle_gaps');
  if (input.lastError) reasons.push('unresolved_worker_error');
  if (input.status !== 'completed' && heartbeatAge > FORWARD_TEST_HEARTBEAT_MAX_AGE_MS) reasons.push('heartbeat_stale');
  return { qualified: reasons.length === 0, elapsedMs, reasons };
}
