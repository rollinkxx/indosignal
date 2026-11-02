const CANDLE_MS = 60 * 60_000;
const MAX_CANDLE_LATENESS_MS = 15 * 60_000;

export function shouldStartForwardTestWorker(runtime = process.env.NEXT_RUNTIME, nodeEnv = process.env.NODE_ENV, hasStrategy = true): boolean {
  return runtime === 'nodejs' && nodeEnv === 'production' && hasStrategy;
}

export function candleObservationIssue(input: { lastProcessedCloseMs: number; candleCloseMs: number; runStartedAtMs: number; nowMs: number; intervalMs?: number; maxLatenessMs?: number }): 'historical_before_start' | 'duplicate_or_old' | 'candle_late' | 'candle_gap' | undefined {
  if (input.candleCloseMs <= input.runStartedAtMs) return 'historical_before_start';
  if (input.candleCloseMs <= input.lastProcessedCloseMs) return 'duplicate_or_old';
  if (input.nowMs - input.candleCloseMs > (input.maxLatenessMs ?? MAX_CANDLE_LATENESS_MS)) return 'candle_late';
  if (input.lastProcessedCloseMs > 0 && input.candleCloseMs - input.lastProcessedCloseMs > (input.intervalMs ?? CANDLE_MS) + 120_000) return 'candle_gap';
  return undefined;
}
