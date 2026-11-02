import { createHash } from 'node:crypto';

export const ZERO_HASH = '0'.repeat(64);

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Audit canonical JSON accepts finite numbers only.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new TypeError('Audit canonical JSON contains an unsupported value.');
}

export function nextAuditHash(previousHash, canonicalEvent) {
  if (!/^[a-f0-9]{64}$/.test(previousHash)) throw new TypeError('Invalid previous audit hash.');
  return createHash('sha256').update(previousHash).update('\n').update(canonicalEvent).digest('hex');
}

export function makeAuditEnvelope(event, sequence) {
  return {
    schemaVersion: 1,
    runId: String(event.runId),
    sequence,
    eventId: String(event.eventId),
    idempotencyKey: String(event.idempotencyKey),
    eventKind: String(event.eventKind),
    sourceEventTimeMs: event.sourceEventTimeMs === null || event.sourceEventTimeMs === undefined ? null : Number(event.sourceEventTimeMs),
    occurredAtMs: Number(event.occurredAtMs),
    createdAt: String(event.createdAt),
    payload: event.payload,
  };
}
