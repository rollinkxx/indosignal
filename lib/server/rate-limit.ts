type Bucket = { tokens: number; lastRefillMs: number };
const buckets = new Map<string, Bucket>();
const CAPACITY = 60;
const REFILL_PER_MS = CAPACITY / 60_000;

export function consumeClientRequest(key: string, nowMs = Date.now()): boolean {
  const current = buckets.get(key) ?? { tokens: CAPACITY, lastRefillMs: nowMs };
  current.tokens = Math.min(CAPACITY, current.tokens + Math.max(0, nowMs - current.lastRefillMs) * REFILL_PER_MS);
  current.lastRefillMs = nowMs;
  if (current.tokens < 1) { buckets.set(key, current); return false; }
  current.tokens -= 1; buckets.set(key, current); return true;
}
