import { createHash, randomUUID } from 'node:crypto';
import { getDbPool } from '../db/client';

type Bucket = { count: number; expiresAt: number; lastAccessMs: number };
const memoryBuckets = new Map<string, Bucket>();
const localConcurrency = new Map<string, number>();
const MAX_MEMORY_BUCKETS = 8_192;
const MEMORY_TTL_MS = 15 * 60_000;
let lastCleanupAt = 0;

export type ApiLimitOptions = { limit: number; windowMs: number; concurrency: number; leaseMs?: number };
export type ApiGuard = { allowed: boolean; retryAfterSeconds: number; release: () => Promise<void> };

function clientIdentity(request: Request): string {
  const configuredHeader = process.env.TRUSTED_PROXY_HEADER?.toLowerCase();
  const allowedHeaders = new Set(['cf-connecting-ip', 'x-real-ip', 'x-client-ip']);
  if (configuredHeader && allowedHeaders.has(configuredHeader)) {
    const candidate = request.headers.get(configuredHeader)?.trim();
    // The deployment must ensure the configured trusted proxy overwrites this header.
    if (candidate && candidate.length <= 64 && /^[0-9a-f:.]+$/i.test(candidate)) return candidate.toLowerCase();
  }
  // Next Request does not expose the socket peer address. Do not trust X-Forwarded-For by default.
  return 'shared-egress';
}

function boundedMemoryConsume(key: string, limit: number, windowMs: number, nowMs: number): boolean {
  for (const [bucketKey, bucket] of memoryBuckets) if (bucket.expiresAt <= nowMs) memoryBuckets.delete(bucketKey);
  while (memoryBuckets.size >= MAX_MEMORY_BUCKETS) {
    const oldest = memoryBuckets.keys().next().value as string | undefined;
    if (!oldest) break;
    memoryBuckets.delete(oldest);
  }
  const current = memoryBuckets.get(key);
  const bucket = !current || current.expiresAt <= nowMs
    ? { count: 0, expiresAt: nowMs + windowMs, lastAccessMs: nowMs }
    : current;
  bucket.lastAccessMs = nowMs;
  bucket.count += 1;
  memoryBuckets.set(key, bucket);
  return bucket.count <= limit;
}

async function consumeDistributed(key: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
  const bucketStart = Math.floor(nowMs / windowMs) * windowMs;
  const expiresAt = new Date(bucketStart + Math.max(windowMs * 2, MEMORY_TTL_MS));
  const result = await getDbPool().query<{ count: number }>(
    `INSERT INTO api_rate_limit_buckets (bucket_key, window_start_ms, request_count, expires_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (bucket_key) DO UPDATE SET
       request_count = CASE WHEN api_rate_limit_buckets.window_start_ms = EXCLUDED.window_start_ms
         THEN api_rate_limit_buckets.request_count + 1 ELSE 1 END,
       window_start_ms = EXCLUDED.window_start_ms,
       expires_at = EXCLUDED.expires_at
     RETURNING request_count AS count`,
    [key, bucketStart, expiresAt],
  );
  if (nowMs - lastCleanupAt >= 5 * 60_000) {
    lastCleanupAt = nowMs;
    void getDbPool().query('DELETE FROM api_rate_limit_buckets WHERE expires_at < now()').catch(() => undefined);
  }
  return Number(result.rows[0]?.count ?? limit + 1) <= limit;
}

async function acquireDistributedLease(endpoint: string, max: number, leaseMs: number): Promise<string | null> {
  const client = await getDbPool().connect();
  const id = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`api-concurrency:${endpoint}`]);
    await client.query('DELETE FROM api_request_leases WHERE endpoint = $1 AND expires_at <= now()', [endpoint]);
    const count = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM api_request_leases WHERE endpoint=$1', [endpoint]);
    if (Number(count.rows[0]?.count ?? 0) >= max) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('INSERT INTO api_request_leases (id, endpoint, expires_at) VALUES ($1, $2, now() + ($3::text || \' milliseconds\')::interval)', [id, endpoint, leaseMs]);
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Distributed fixed-window rate limit plus concurrency lease. X-Forwarded-For is never trusted. */
export async function acquireApiRequest(request: Request, endpoint: string, options: ApiLimitOptions, nowMs = Date.now()): Promise<ApiGuard> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || !Number.isInteger(options.windowMs) || options.windowMs < 1 || !Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new RangeError('Invalid API rate-limit configuration');
  }
  const identityHash = createHash('sha256').update(clientIdentity(request)).digest('hex');
  const key = `${endpoint}:${identityHash}`;
  const distributed = Boolean(process.env.DATABASE_URL);
  if (!distributed && process.env.NODE_ENV === 'production') throw new Error('Distributed API rate limiting requires DATABASE_URL.');
  const allowed = distributed
    ? await consumeDistributed(key, options.limit, options.windowMs, nowMs)
    : boundedMemoryConsume(key, options.limit, options.windowMs, nowMs);
  if (!allowed) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(options.windowMs / 1000)), release: async () => undefined };

  let leaseId: string | null = null;
  if (distributed) leaseId = await acquireDistributedLease(endpoint, options.concurrency, options.leaseMs ?? 60_000);
  else {
    const count = localConcurrency.get(endpoint) ?? 0;
    if (count >= options.concurrency) return { allowed: false, retryAfterSeconds: 1, release: async () => undefined };
    localConcurrency.set(endpoint, count + 1);
  }
  if (distributed && !leaseId) return { allowed: false, retryAfterSeconds: 1, release: async () => undefined };

  return {
    allowed: true,
    retryAfterSeconds: 0,
    release: async () => {
      if (leaseId) await getDbPool().query('DELETE FROM api_request_leases WHERE id=$1', [leaseId]);
      else localConcurrency.set(endpoint, Math.max(0, (localConcurrency.get(endpoint) ?? 1) - 1));
    },
  };
}

export function resetApiLimitsForTest(): void { memoryBuckets.clear(); localConcurrency.clear(); lastCleanupAt = 0; }
export function apiLimitMemoryStats() { return { buckets: memoryBuckets.size, maxBuckets: MAX_MEMORY_BUCKETS }; }
