import { canonicalJson, makeAuditEnvelope, nextAuditHash, ZERO_HASH } from '../lib/audit/hash-chain.mjs';

export async function backfillAuditChain(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(141414, 1008)');
    const events = await client.query(
      `SELECT e.id, e.run_id, e.idempotency_key, e.event_kind, e.source_event_time_ms, e.occurred_at_ms,
              e.payload_json, to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS created_at_exact
       FROM forward_test_events e
       LEFT JOIN forward_test_event_chain c ON c.event_id=e.id
       WHERE c.event_id IS NULL
       ORDER BY e.run_id, e.occurred_at_ms, e.created_at, e.id`,
    );
    const tailByRun = new Map();
    for (const row of events.rows) {
      const runId = String(row.run_id);
      let tail = tailByRun.get(runId);
      if (!tail) {
        const result = await client.query(
          'SELECT sequence::text, event_hash, canonical_event FROM forward_test_event_chain WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1',
          [runId],
        );
        const latest = result.rows[0];
        const latestEnvelope = latest ? JSON.parse(String(latest.canonical_event)) : undefined;
        tail = {
          sequence: Number(latest?.sequence ?? 0),
          hash: String(latest?.event_hash ?? ZERO_HASH),
          createdAt: latestEnvelope?.createdAt === undefined ? undefined : String(latestEnvelope.createdAt),
        };
        tailByRun.set(runId, tail);
      }
      if (tail.createdAt && String(row.created_at_exact) < tail.createdAt) {
        throw new Error(`Refusing to append an older unhashed event after the current chain tail for run ${runId}.`);
      }
      const sequence = tail.sequence + 1;
      const envelope = makeAuditEnvelope({
        runId, eventId: String(row.id), idempotencyKey: String(row.idempotency_key), eventKind: String(row.event_kind),
        sourceEventTimeMs: row.source_event_time_ms === null ? null : Number(row.source_event_time_ms),
        occurredAtMs: Number(row.occurred_at_ms), createdAt: String(row.created_at_exact), payload: row.payload_json,
      }, sequence);
      const canonicalEvent = canonicalJson(envelope);
      const eventHash = nextAuditHash(tail.hash, canonicalEvent);
      await client.query(
        `INSERT INTO forward_test_event_chain (run_id, sequence, event_id, idempotency_key, previous_hash, event_hash, canonical_event)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [runId, sequence, row.id, row.idempotency_key, tail.hash, eventHash, canonicalEvent],
      );
      tail.sequence = sequence;
      tail.hash = eventHash;
      tail.createdAt = String(row.created_at_exact);
    }
    await client.query('COMMIT');
    return { backfilled: events.rowCount ?? events.rows.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
