export type JournalEvent = { idempotencyKey: string; accountId: string; strategyId: string; pairId: string; kind: 'decision' | 'order_created' | 'fill' | 'risk_block' | 'circuit_breaker'; occurredAtMs: number; payload: Record<string, string | number | boolean | string[]> };

export function assertAppendOnly(existing: readonly JournalEvent[], next: JournalEvent): JournalEvent[] { if (existing.some((event) => event.idempotencyKey === next.idempotencyKey)) return [...existing]; return [...existing, Object.freeze({ ...next, payload: { ...next.payload } })]; }
