const REQUIRED_MIGRATIONS = ['0003-postgresql-initial', '0004-forward-test', '0005-multi-pair-scan', '0006-retire_legacy_btc_forward_test', '0007-api_limits', '0008-event_hash_chain', '0009-database_constraints'];

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForDatabaseAndMigrations(): Promise<void> {
  const { getDbPool } = await import('./lib/db/client');
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const roleResult = await getDbPool().query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
      if (roleResult.rows[0]?.rolsuper) throw new Error('runtime DATABASE_URL must use a non-superuser PostgreSQL role');
      const result = await getDbPool().query<{ version: string }>('SELECT version FROM schema_migrations');
      const applied = new Set(result.rows.map((row) => row.version));
      const missing = REQUIRED_MIGRATIONS.filter((version) => !applied.has(version));
      if (missing.length) throw new Error(`required database migrations are missing: ${missing.join(',')}`);
      return;
    } catch (error) {
      if (error instanceof Error && (error.message.startsWith('runtime DATABASE_URL') || error.message.startsWith('required database migrations'))) throw error;
      lastError = error;
      if (attempt < 9) await sleep(Math.min(1_000 * 2 ** attempt, 10_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('database startup readiness failed');
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  try {
    await waitForDatabaseAndMigrations();
    // Independent advisory locks and start guards preserve separate worker lifecycles.
    const [{ startMultiPairScanner }, { startForwardTestWorker }] = await Promise.all([
      import('./lib/forward-test/multi-pair-worker'),
      import('./lib/forward-test/worker'),
    ]);
    startMultiPairScanner();
    startForwardTestWorker();
  } catch (error) {
    console.error('[startup] paper scanners not started:', error instanceof Error ? error.message.slice(0, 300) : 'database unavailable');
  }
}
