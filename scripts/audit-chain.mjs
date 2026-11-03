import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { canonicalJson, makeAuditEnvelope, nextAuditHash, ZERO_HASH } from '../lib/audit/hash-chain.mjs';

const { Client } = pg;
const mode = process.argv[2] ?? 'verify';
const connectionString = process.env.AUDIT_DATABASE_URL ?? process.env.DATABASE_URL;
const sslSetting = process.env.AUDIT_DATABASE_SSL ?? process.env.DATABASE_SSL;
const client = connectionString ? new Client({ connectionString, ssl: sslSetting === 'disable' ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 10_000 }) : undefined;

function eventFrom(row) {
  return {
    runId: String(row.run_id), eventId: String(row.event_id), idempotencyKey: String(row.idempotency_key),
    eventKind: String(row.event_kind), sourceEventTimeMs: row.source_event_time_ms === null ? null : Number(row.source_event_time_ms),
    occurredAtMs: Number(row.occurred_at_ms), createdAt: String(row.created_at_exact), payload: row.payload_json,
  };
}

async function verify() {
  await client.query('BEGIN READ ONLY');
  try {
    const counts = await client.query(
      `SELECT (SELECT count(*)::bigint FROM forward_test_events) AS events,
              (SELECT count(*)::bigint FROM forward_test_event_chain) AS chain_entries,
              (SELECT count(*)::bigint FROM forward_test_events e LEFT JOIN forward_test_event_chain c ON c.event_id=e.id WHERE c.event_id IS NULL) AS missing_chain,
              (SELECT count(*)::bigint FROM forward_test_event_chain c LEFT JOIN forward_test_events e ON e.id=c.event_id WHERE e.id IS NULL) AS orphan_chain`,
    );
    const rows = await client.query(
      `SELECT c.run_id, c.sequence::text AS sequence, c.event_id, c.idempotency_key AS chain_key,
              c.previous_hash, c.event_hash, c.canonical_event, e.idempotency_key, e.event_kind,
              e.source_event_time_ms, e.occurred_at_ms, e.payload_json,
              to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS created_at_exact
       FROM forward_test_event_chain c JOIN forward_test_events e ON e.id=c.event_id
       ORDER BY c.run_id, c.sequence`,
    );
    let currentRun = '';
    let expectedSequence = 0;
    let previousHash = ZERO_HASH;
    const issues = [];
    const tails = new Map();
    for (const row of rows.rows) {
      const runId = String(row.run_id);
      if (runId !== currentRun) { currentRun = runId; expectedSequence = 0; previousHash = ZERO_HASH; }
      expectedSequence += 1;
      const sequence = Number(row.sequence);
      const source = eventFrom(row);
      const envelope = makeAuditEnvelope(source, sequence);
      const canonical = canonicalJson(envelope);
      const expectedHash = nextAuditHash(previousHash, canonical);
      if (sequence !== expectedSequence) issues.push({ runId, type: 'sequence_gap', expected: expectedSequence, actual: sequence });
      if (String(row.chain_key) !== String(row.idempotency_key)) issues.push({ runId, sequence, type: 'idempotency_key_mismatch' });
      if (String(row.previous_hash).trim() !== previousHash) issues.push({ runId, sequence, type: 'previous_hash_mismatch' });
      if (String(row.canonical_event) !== canonical) issues.push({ runId, sequence, type: 'canonical_event_mismatch' });
      if (String(row.event_hash).trim() !== expectedHash) issues.push({ runId, sequence, type: 'event_hash_mismatch' });
      previousHash = expectedHash;
      tails.set(runId, { sequence, eventHash: expectedHash });
    }
    const ledger = await client.query(
      `WITH replay AS (
         SELECT account_id, id, balance_after,
                sum(delta_cash) OVER (PARTITION BY account_id ORDER BY created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS replayed_balance
         FROM paper_cash_ledger
       ) SELECT count(*)::bigint AS checked,
                count(*) FILTER (WHERE abs(balance_after - replayed_balance) > 0.000000000001)::bigint AS mismatches
         FROM replay`,
    );
    const links = await client.query(
      `SELECT
         (SELECT count(*)::bigint FROM forward_test_events e LEFT JOIN paper_orders o ON o.id::text=e.payload_json->>'orderId' WHERE e.event_kind='order_created' AND o.id IS NULL) AS missing_orders,
         (SELECT count(*)::bigint FROM forward_test_events e LEFT JOIN paper_fills f ON f.id::text=e.payload_json->>'fillId' WHERE e.event_kind='fill' AND f.id IS NULL) AS missing_event_fills,
         (SELECT count(*)::bigint
            FROM forward_test_events e
            LEFT JOIN paper_cash_ledger l
              ON l.source_payload->>'fillId'=NULLIF(e.payload_json->>'fillId','')
             AND l.run_id=e.run_id
             AND l.event_kind IN ('buy_fill','sell_fill')
           WHERE e.event_kind='fill'
             AND (NULLIF(e.payload_json->>'fillId','') IS NULL OR l.id IS NULL
               OR (e.payload_json->>'side'='buy' AND l.event_kind <> 'buy_fill')
               OR (e.payload_json->>'side'='sell' AND l.event_kind <> 'sell_fill'))) AS missing_ledger_links,
         (SELECT count(*)::bigint FROM closed_trades t LEFT JOIN paper_fills f ON f.id=t.entry_fill_id WHERE f.id IS NULL) +
         (SELECT count(*)::bigint FROM closed_trades t LEFT JOIN paper_fills f ON f.id=t.exit_fill_id WHERE f.id IS NULL) AS missing_closed_trade_fills`,
    );
    const positionReplay = await client.query(
      `WITH tracked AS (
         SELECT DISTINCT account_id, strategy_id, pair_id FROM forward_test_runs
       ), flows AS (
         SELECT o.account_id, o.strategy_id, o.pair_id,
           sum(CASE WHEN o.side='buy' THEN f.base_amount ELSE -f.base_amount END) AS net_base
         FROM paper_fills f JOIN paper_orders o ON o.id=f.order_id
         JOIN tracked t ON (t.account_id,t.strategy_id,t.pair_id)=(o.account_id,o.strategy_id,o.pair_id)
         GROUP BY o.account_id,o.strategy_id,o.pair_id
       ) SELECT count(*)::bigint AS positions_checked,
                count(*) FILTER (WHERE abs(coalesce(f.net_base,0)-coalesce(p.base_amount,0))>0.000000000001)::bigint AS mismatches
         FROM tracked t LEFT JOIN flows f USING (account_id,strategy_id,pair_id)
         LEFT JOIN positions p USING (account_id,strategy_id,pair_id)`,
    );
    if (Number(counts.rows[0].missing_chain) || Number(counts.rows[0].orphan_chain) || Number(counts.rows[0].events) !== Number(counts.rows[0].chain_entries)) issues.push({ type: 'event_chain_coverage_mismatch', ...counts.rows[0] });
    if (Number(ledger.rows[0].mismatches)) issues.push({ type: 'cash_ledger_reconciliation_mismatch', ...ledger.rows[0] });
    if (Object.values(links.rows[0]).some((value) => Number(value) > 0)) issues.push({ type: 'event_order_fill_ledger_trace_mismatch', ...links.rows[0] });
    if (Number(positionReplay.rows[0].mismatches)) issues.push({ type: 'forward_position_replay_mismatch', ...positionReplay.rows[0] });
    const report = { ok: issues.length === 0, counts: counts.rows[0], ledger: ledger.rows[0], links: links.rows[0], positionReplay: positionReplay.rows[0], runsWithEvents: tails.size, tails: Object.fromEntries(tails), issues };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally { await client.query('ROLLBACK').catch(() => undefined); }
}

async function snapshot() {
  const key = process.env.AUDIT_SNAPSHOT_HMAC_KEY;
  const output = process.env.AUDIT_SNAPSHOT_OUT;
  if (!key || key.length < 32) throw new Error('AUDIT_SNAPSHOT_HMAC_KEY must contain at least 32 characters.');
  if (!output) throw new Error('AUDIT_SNAPSHOT_OUT must name the local snapshot file; upload it separately to immutable storage.');
  const tails = await client.query(
    `SELECT DISTINCT ON (run_id) run_id, sequence::text AS sequence, event_hash
     FROM forward_test_event_chain ORDER BY run_id, sequence DESC`,
  );
  const counts = await client.query('SELECT count(*)::text AS events FROM forward_test_events');
  const ledger = await client.query(`SELECT id,run_id,account_id,idempotency_key,event_kind,currency,delta_cash::text,balance_after::text,source_payload,to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') AS created_at FROM paper_cash_ledger ORDER BY run_id,created_at,id`);
  const positions = await client.query(`SELECT account_id,strategy_id,pair_id,base_amount::text,average_entry::text,stop_price::text,realized_pnl::text,entry_fill_id,entry_fee::text,entry_tax::text,risk_budget::text,entry_at FROM positions ORDER BY account_id,strategy_id,pair_id`);
  const trades = await client.query(`SELECT id,account_id,strategy_id,pair_id,entry_fill_id,exit_fill_id,base_amount::text,entry_price::text,exit_price::text,pnl_quote::text,pnl_r::text,closed_at,idempotency_key FROM closed_trades ORDER BY account_id,closed_at,id`);
  const digestRows = (rows) => { const hash = createHash('sha256'); for (const row of rows) hash.update(canonicalJson(row)).update('\n'); return hash.digest('hex'); };
  const payload = {
    schemaVersion: 1, exportedAt: new Date().toISOString(), eventCount: counts.rows[0].events,
    tails: tails.rows.map((row) => ({ runId: String(row.run_id), sequence: String(row.sequence), eventHash: String(row.event_hash).trim() })).sort((a, b) => a.runId.localeCompare(b.runId)),
    ledger: { rows: ledger.rowCount, sha256: digestRows(ledger.rows) },
    positions: { rows: positions.rowCount, sha256: digestRows(positions.rows) },
    closedTrades: { rows: trades.rowCount, sha256: digestRows(trades.rows) },
  };
  const canonical = canonicalJson(payload);
  const signature = createHmac('sha256', key).update(canonical).digest('hex');
  await writeFile(output, `${JSON.stringify({ payload, hmacSha256: signature }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ output, eventCount: counts.rows[0].events, runs: tails.rowCount, note: 'Copy to separately administered immutable/WORM storage; local file is not an external anchor.' }));
}

async function verifySnapshot() {
  const key = process.env.AUDIT_SNAPSHOT_HMAC_KEY;
  const filename = process.env.AUDIT_SNAPSHOT_FILE;
  if (!key || key.length < 32 || !filename) throw new Error('AUDIT_SNAPSHOT_HMAC_KEY (32+ chars) and AUDIT_SNAPSHOT_FILE are required.');
  const envelope = JSON.parse(await readFile(filename, 'utf8'));
  const expected = createHmac('sha256', key).update(canonicalJson(envelope.payload)).digest();
  const actual = Buffer.from(String(envelope.hmacSha256 ?? ''), 'hex');
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  console.log(JSON.stringify({ ok, eventCount: envelope.payload?.eventCount, runs: envelope.payload?.tails?.length }));
  if (!ok) process.exitCode = 1;
}

if (mode === 'verify-snapshot') {
  await verifySnapshot();
} else {
  if (!client) throw new Error('AUDIT_DATABASE_URL atau DATABASE_URL wajib tersedia.');
  await client.connect();
  try {
    if (mode === 'verify') await verify();
    else if (mode === 'snapshot') await snapshot();
    else throw new Error('Mode must be verify, snapshot, or verify-snapshot.');
  } finally { await client.end(); }
}
