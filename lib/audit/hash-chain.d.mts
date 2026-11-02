export const ZERO_HASH: string;
export function canonicalJson(value: unknown): string;
export function nextAuditHash(previousHash: string, canonicalEvent: string): string;
export function makeAuditEnvelope(event: {
  runId: string; sequence?: number; eventId: string; idempotencyKey: string; eventKind: string;
  sourceEventTimeMs?: number | null; occurredAtMs: number; createdAt: string; payload: unknown;
}, sequence: number): Record<string, unknown>;
