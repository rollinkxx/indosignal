import { describe, expect, it } from 'vitest';
import { canonicalJson, makeAuditEnvelope, nextAuditHash, ZERO_HASH } from '../lib/audit/hash-chain.mjs';

const event = { runId: 'run-a', eventId: 'event-a', idempotencyKey: 'decision-1', eventKind: 'decision', sourceEventTimeMs: 100, occurredAtMs: 101, createdAt: '2026-01-01T00:00:00.000000+00', payload: { z: 2, nested: { b: true, a: 1 } } };

describe('tamper-evident audit hash chain primitives', () => {
  it('canonicalizes object key order deterministically', () => {
    expect(canonicalJson({ b: 1, a: { y: 2, x: 1 } })).toBe(canonicalJson({ a: { x: 1, y: 2 }, b: 1 }));
  });

  it('binds event id, timestamps, payload, sequence and prior hash', () => {
    const envelope = makeAuditEnvelope(event, 1);
    const canonical = canonicalJson(envelope);
    const hash = nextAuditHash(ZERO_HASH, canonical);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(nextAuditHash(ZERO_HASH, canonicalJson(makeAuditEnvelope({ ...event, occurredAtMs: 102 }, 1)))).not.toBe(hash);
    expect(nextAuditHash(ZERO_HASH, canonicalJson(makeAuditEnvelope({ ...event, payload: { ...event.payload, z: 3 } }, 1)))).not.toBe(hash);
    expect(nextAuditHash('a'.repeat(64), canonical)).not.toBe(hash);
  });

  it('rejects non-finite values and malformed prior hashes', () => {
    expect(() => canonicalJson({ price: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => nextAuditHash('bad', '{}')).toThrow();
  });
});
