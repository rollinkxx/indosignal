import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { applyDisposableRuntimeDatabase, DISPOSABLE_DATABASE_ACK_VALUE, resolveDisposableDatabaseTargets } from '../scripts/disposable-database.mjs';
import { describe, expect, it } from 'vitest';

const cases: Array<{ name: string; script: string; args: string[]; campaign?: string }> = [
  { name: 'restart proof', script: 'scripts/db-restart-proof.ts', args: [] },
  { name: 'forward-test orchestrator', script: 'scripts/forward-test-db-proof.ts', args: [] },
  { name: 'forward-test seed mode', script: 'scripts/forward-test-db-proof.ts', args: ['seed'], campaign: 'FORWARD_TEST_CAMPAIGN_KEY' },
  { name: 'forward-test verify mode', script: 'scripts/forward-test-db-proof.ts', args: ['verify'], campaign: 'FORWARD_TEST_CAMPAIGN_KEY' },
  { name: 'multipair orchestrator', script: 'scripts/multi-pair-scan-db-proof.ts', args: [] },
  { name: 'multipair seed mode', script: 'scripts/multi-pair-scan-db-proof.ts', args: ['seed'], campaign: 'MULTI_PAIR_PROOF_CAMPAIGN_KEY' },
  { name: 'multipair verify mode', script: 'scripts/multi-pair-scan-db-proof.ts', args: ['verify'], campaign: 'MULTI_PAIR_PROOF_CAMPAIGN_KEY' },
];

describe('database proof safety', () => {
  it.each(cases)('$name fails closed without an explicitly disposable target', ({ script, args, campaign }) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test' };
    for (const key of [
      'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL',
      'DISPOSABLE_DATABASE_ACK', 'TEST_DATABASE_SSL', 'TEST_MIGRATION_DATABASE_SSL',
      'FORWARD_TEST_CAMPAIGN_KEY', 'MULTI_PAIR_PROOF_CAMPAIGN_KEY',
    ]) delete env[key];
    if (campaign) env[campaign] = 'regression-test-campaign';

    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(script), ...args], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.error, output).toBeUndefined();
    expect(result.status, output).not.toBe(0);
    expect(output).toMatch(/TEST_DATABASE_URL|DISPOSABLE_DATABASE_ACK|disposable\/staging/i);
  });

  it('requires the explicit disposable-target acknowledgement', () => {
    expect(() => resolveDisposableDatabaseTargets({ NODE_ENV: 'test', TEST_DATABASE_URL: 'postgres://proof@localhost/indosignal_test' } as NodeJS.ProcessEnv))
      .toThrow('DISPOSABLE_DATABASE_ACK');
  });

  it('rejects a test target that aliases runtime or migrator database identity', () => {
    const base = {
      NODE_ENV: 'test',
      DISPOSABLE_DATABASE_ACK: DISPOSABLE_DATABASE_ACK_VALUE,
      TEST_DATABASE_URL: 'postgres://test-role@db.example:5432/indosignal_test?sslmode=require',
      TEST_MIGRATION_DATABASE_URL: 'postgres://migration-role@db.example:5432/indosignal_test?sslmode=require',
    } as NodeJS.ProcessEnv;
    expect(() => resolveDisposableDatabaseTargets({ ...base, DATABASE_URL: 'postgres://other@DB.example/indosignal_test' } as NodeJS.ProcessEnv, { requireMigration: true }))
      .toThrow('berbeda dari target DATABASE_URL');
    expect(() => resolveDisposableDatabaseTargets({ ...base, MIGRATION_DATABASE_URL: 'postgres://other@db.example/indosignal_test' } as NodeJS.ProcessEnv, { requireMigration: true }))
      .toThrow('berbeda dari target MIGRATION_DATABASE_URL');
  });

  it('requires runtime and test migrator URLs to target the same disposable database', () => {
    const env = {
      NODE_ENV: 'test',
      DISPOSABLE_DATABASE_ACK: DISPOSABLE_DATABASE_ACK_VALUE,
      TEST_DATABASE_URL: 'postgres://runtime@localhost:5432/indosignal_test',
      TEST_MIGRATION_DATABASE_URL: 'postgres://migrator@localhost:5432/another_database',
    } as NodeJS.ProcessEnv;
    expect(() => resolveDisposableDatabaseTargets(env, { requireMigration: true }))
      .toThrow('database disposable yang sama');
  });

  it('returns separate runtime and migration credentials for the same disposable database', () => {
    const env = {
      NODE_ENV: 'test',
      DISPOSABLE_DATABASE_ACK: DISPOSABLE_DATABASE_ACK_VALUE,
      TEST_DATABASE_URL: 'postgres://runtime@localhost:5432/indosignal_test',
      TEST_MIGRATION_DATABASE_URL: 'postgres://migrator@localhost:5432/indosignal_test',
    } as NodeJS.ProcessEnv;
    expect(resolveDisposableDatabaseTargets(env, { requireMigration: true })).toEqual({
      testDatabaseUrl: env.TEST_DATABASE_URL,
      testMigrationDatabaseUrl: env.TEST_MIGRATION_DATABASE_URL,
    });
  });

  it('only applies the validated test runtime URL and SSL setting', () => {
    const env = {
      NODE_ENV: 'production',
      DISPOSABLE_DATABASE_ACK: DISPOSABLE_DATABASE_ACK_VALUE,
      TEST_DATABASE_URL: 'postgres://runtime@localhost:5432/indosignal_test',
      DATABASE_URL: 'postgres://runtime@localhost:5432/indosignal_prod',
      TEST_DATABASE_SSL: 'disable',
    } as NodeJS.ProcessEnv;
    applyDisposableRuntimeDatabase(env);
    expect(env.NODE_ENV).toBe('test');
    expect(env.DATABASE_URL).toBe(env.TEST_DATABASE_URL);
    expect(env.DATABASE_SSL).toBe('disable');
  });

  it('does not let a test-mode migration fall back to ambient migration credentials', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', MIGRATION_DATABASE_URL: 'postgres://fixture_user@db.example/production' };
    for (const key of ['TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL', 'DISPOSABLE_DATABASE_ACK']) delete env[key];
    const result = spawnSync(process.execPath, [resolve('scripts/migrate.mjs')], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 10_000 });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain('DISPOSABLE_DATABASE_ACK');
    expect(output).not.toContain('fixture_user');
  });

  it('rejects an aliased runtime target in a direct seed mode before connecting', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DISPOSABLE_DATABASE_ACK: DISPOSABLE_DATABASE_ACK_VALUE,
      TEST_DATABASE_URL: 'postgres://test-role@localhost:5432/protected',
      TEST_MIGRATION_DATABASE_URL: 'postgres://migrator@localhost:5432/protected',
      DATABASE_URL: 'postgres://runtime@localhost:5432/protected',
      MIGRATION_DATABASE_URL: 'postgres://migrator@localhost:5432/production',
      FORWARD_TEST_CAMPAIGN_KEY: 'regression-campaign',
    };
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/forward-test-db-proof.ts'), 'seed'], {
      cwd: process.cwd(), env, encoding: 'utf8', timeout: 10_000,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain('berbeda dari target DATABASE_URL');
    expect(output).not.toContain('postgres://');
  });
});
