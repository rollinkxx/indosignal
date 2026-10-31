type Bucket = { tokens: number; lastRefillMs: number };

const buckets = new Map<string, Bucket>();
const CAPACITY = 120;
const REFILL_PER_MS = CAPACITY / 60_000;

export function consumeProviderRequest(key = 'indodax-public', nowMs = Date.now()): void {
  const current = buckets.get(key) ?? { tokens: CAPACITY, lastRefillMs: nowMs };
  const elapsed = Math.max(0, nowMs - current.lastRefillMs);
  current.tokens = Math.min(CAPACITY, current.tokens + elapsed * REFILL_PER_MS);
  current.lastRefillMs = nowMs;
  if (current.tokens < 1) throw new Error('Rate limit internal Indodax tercapai; request ditahan tanpa fallback data.');
  current.tokens -= 1;
  buckets.set(key, current);
}
