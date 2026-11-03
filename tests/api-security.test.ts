import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireApiRequest, apiLimitMemoryStats, resetApiLimitsForTest } from '../lib/server/rate-limit';
import { redactOperationalError } from '../lib/server/public-status';

afterEach(() => { resetApiLimitsForTest(); vi.unstubAllEnvs(); });

describe('API abuse controls', () => {
  it('redacts internal worker error details from public status payloads', () => {
    const result = redactOperationalError({ status: 'running', lastError: 'password authentication failed for role runtime' });
    expect(result.lastError).toBe('Worker mengalami error; detail teknis tersedia di log operasional.');
    expect(JSON.stringify(result)).not.toContain('password authentication failed');
  });

  it('does not trust spoofed X-Forwarded-For by default', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('TRUSTED_PROXY_HEADER', '');
    const first = await acquireApiRequest(new Request('https://example.test/api/signals', { headers: { 'x-forwarded-for': '198.51.100.1' } }), '/api/signals', { limit: 1, windowMs: 60_000, concurrency: 1 }, 1000);
    expect(first.allowed).toBe(true);
    await first.release();
    const second = await acquireApiRequest(new Request('https://example.test/api/signals', { headers: { 'x-forwarded-for': '203.0.113.2' } }), '/api/signals', { limit: 1, windowMs: 60_000, concurrency: 1 }, 1001);
    expect(second.allowed).toBe(false);
  });

  it('enforces request concurrency and permits a slot after release', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', '');
    const request = new Request('https://example.test/api/backtest');
    const options = { limit: 10, windowMs: 60_000, concurrency: 1 };
    const first = await acquireApiRequest(request, '/api/backtest', options, 1000);
    const blocked = await acquireApiRequest(request, '/api/backtest', options, 1001);
    expect(first.allowed).toBe(true);
    expect(blocked.allowed).toBe(false);
    await first.release();
    const afterRelease = await acquireApiRequest(request, '/api/backtest', options, 1002);
    expect(afterRelease.allowed).toBe(true);
    await afterRelease.release();
  });

  it('keeps local fallback buckets bounded', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', '');
    const options = { limit: 100, windowMs: 60_000, concurrency: 1 };
    for (let index = 0; index < 8_300; index += 1) {
      const guard = await acquireApiRequest(new Request(`https://example.test/${index}`), `/api/test-${index}`, options, index);
      if (guard.allowed) await guard.release();
    }
    expect(apiLimitMemoryStats().buckets).toBeLessThanOrEqual(apiLimitMemoryStats().maxBuckets);
  });
});
