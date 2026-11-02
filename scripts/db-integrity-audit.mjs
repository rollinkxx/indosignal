import pg from 'pg';
const { Client } = pg;
const connectionString = process.env.AUDIT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('AUDIT_DATABASE_URL atau DATABASE_URL wajib tersedia.');
const ssl = process.env.AUDIT_DATABASE_SSL ?? process.env.DATABASE_SSL;
const client = new Client({ connectionString, ssl: ssl === 'disable' ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const unvalidated = await client.query(`SELECT conrelid::regclass::text AS table_name, conname, contype FROM pg_constraint WHERE NOT convalidated ORDER BY table_name, conname`);
  const orphanChecks = await client.query(`
    SELECT 'paper_orders.account' AS check_name, count(*)::bigint AS count FROM paper_orders o LEFT JOIN virtual_accounts a ON a.id=o.account_id WHERE a.id IS NULL
    UNION ALL SELECT 'paper_orders.strategy', count(*)::bigint FROM paper_orders o LEFT JOIN strategies s ON s.id=o.strategy_id WHERE s.id IS NULL
    UNION ALL SELECT 'paper_fills.order', count(*)::bigint FROM paper_fills f LEFT JOIN paper_orders o ON o.id=f.order_id WHERE o.id IS NULL
    UNION ALL SELECT 'closed_trades.entry_fill', count(*)::bigint FROM closed_trades t LEFT JOIN paper_fills f ON f.id=t.entry_fill_id WHERE f.id IS NULL
    UNION ALL SELECT 'closed_trades.exit_fill', count(*)::bigint FROM closed_trades t LEFT JOIN paper_fills f ON f.id=t.exit_fill_id WHERE f.id IS NULL
    UNION ALL SELECT 'forward_event_chain.missing', count(*)::bigint FROM forward_test_events e LEFT JOIN forward_test_event_chain c ON c.event_id=e.id WHERE c.event_id IS NULL
    UNION ALL SELECT 'forward_event_chain.orphan', count(*)::bigint FROM forward_test_event_chain c LEFT JOIN forward_test_events e ON e.id=c.event_id WHERE e.id IS NULL
  `);
  const ledger = await client.query(`WITH replay AS (
    SELECT account_id, balance_after,
      sum(delta_cash) OVER (PARTITION BY account_id ORDER BY created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS expected
    FROM paper_cash_ledger
  ) SELECT count(*)::bigint AS rows_checked, count(*) FILTER (WHERE abs(balance_after-expected)>0.000000000001)::bigint AS mismatches FROM replay`);
  const duplicateIdempotency = await client.query(`SELECT 'forward_test_events' AS table_name, count(*)::bigint AS duplicate_groups FROM (SELECT run_id,idempotency_key FROM forward_test_events GROUP BY 1,2 HAVING count(*)>1) q UNION ALL SELECT 'paper_cash_ledger',count(*)::bigint FROM (SELECT run_id,idempotency_key FROM paper_cash_ledger GROUP BY 1,2 HAVING count(*)>1) q`);
  const report = { ok: orphanChecks.rows.every((row) => Number(row.count) === 0) && Number(ledger.rows[0].mismatches) === 0, unvalidatedConstraints: unvalidated.rows, orphanChecks: orphanChecks.rows, ledger: ledger.rows[0], duplicateIdempotency: duplicateIdempotency.rows };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}
