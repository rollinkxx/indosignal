export function summarizeIntegrity({ unvalidatedConstraints = [], orphanChecks = [], ledger = {}, duplicateIdempotency = [], chain = {} } = {}) {
  const unvalidatedCount = unvalidatedConstraints.length;
  const orphanCount = orphanChecks.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  const duplicateCount = duplicateIdempotency.reduce((sum, row) => sum + Number(row.duplicate_groups ?? 0), 0);
  const ledgerMismatches = Number(ledger.mismatches ?? 0);
  const chainIssues = Number(chain.missing ?? 0) + Number(chain.orphan ?? 0) + Number(chain.mismatch ?? 0);
  const checks = {
    constraints: unvalidatedCount === 0,
    orphans: orphanCount === 0,
    duplicateIdempotency: duplicateCount === 0,
    ledger: ledgerMismatches === 0,
    chain: chainIssues === 0,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    status: {
      constraints: unvalidatedCount ? 'failed' : 'passed',
      orphans: orphanCount ? 'failed' : 'passed',
      duplicateIdempotency: duplicateCount ? 'failed' : 'passed',
      ledger: ledgerMismatches ? 'failed' : 'passed',
      chain: chainIssues ? 'failed' : 'passed',
    },
    totals: { unvalidatedCount, orphanCount, duplicateCount, ledgerMismatches, chainIssues },
  };
}
