import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { summarizeIntegrity } from '../lib/audit/integrity.mjs';
import { getStrategy } from '../lib/strategy/registry';

describe('post-merge remediation guards', () => {
  it.each([
    ['unvalidated constraint', { unvalidatedConstraints: [{ conname: 'x' }] }],
    ['duplicate idempotency', { duplicateIdempotency: [{ duplicate_groups: '1' }] }],
    ['orphan record', { orphanChecks: [{ count: '1' }] }],
    ['ledger mismatch', { ledger: { mismatches: '1' } }],
    ['chain mismatch', { chain: { missing: '1' } }],
  ])('%s fails the integrity decision', (_name, input) => {
    expect(summarizeIntegrity(input).ok).toBe(false);
  });

  it('reports a clean empty audit as passed', () => {
    const report = summarizeIntegrity({});
    expect(report.ok).toBe(true);
    expect(report.status).toEqual({ constraints: 'passed', orphans: 'passed', duplicateIdempotency: 'passed', ledger: 'passed', chain: 'passed' });
  });

  it('mean-reversion never enters outside the actual range regime', () => {
    const strategy = getStrategy('mean-reversion')!;
    const candles = Array.from({ length: 40 }, (_, index) => ({ high: 100 + index, low: 90 + index, close: 95 + index, volume: 100 }));
    expect(strategy.evaluate({ candles, regime: 'trend' }).action).toBe('hold');
    expect(strategy.evaluate({ candles, regime: 'volatile' }).action).toBe('hold');
  });
  it('does not permit production migration to fall back to runtime credentials', async () => {
    const source = await readFile(new URL('../scripts/migrate.mjs', import.meta.url), 'utf8');
    expect(source).toContain("process.env.NODE_ENV === 'production'");
    expect(source).toContain('ALLOW_RUNTIME_DATABASE_MIGRATION');
    expect(source).toContain('DATABASE_URL runtime tidak boleh digunakan sebagai migrator');
  });

  it('does not pass migration credentials into the Next process', async () => {
    const source = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
    expect(source).toContain('unset MIGRATION_DATABASE_URL MIGRATION_DATABASE_SSL');
  });
});
