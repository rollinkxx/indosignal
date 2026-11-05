export const DISPOSABLE_DATABASE_ACK_VALUE = 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE';

const ROUTING_QUERY_KEYS = new Set([
  'database',
  'dbname',
  'host',
  'hostaddr',
  'options',
  'passfile',
  'password',
  'port',
  'service',
  'user',
]);

function databaseIdentity(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} bukan URL PostgreSQL yang valid.`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error(`${label} harus menunjuk ke database PostgreSQL.`);
  }
  for (const key of url.searchParams.keys()) {
    if (ROUTING_QUERY_KEYS.has(key.toLowerCase())) {
      throw new Error(`${label} tidak boleh memakai parameter query yang dapat mengubah target koneksi.`);
    }
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error(`${label} harus menyebut nama database.`);
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}/${database}`;
}

function requireUrl(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} wajib diisi untuk proof database disposable.`);
  return value;
}

export function resolveDisposableDatabaseTargets(env, { requireMigration = false } = {}) {
  if (env.DISPOSABLE_DATABASE_ACK !== DISPOSABLE_DATABASE_ACK_VALUE) {
    throw new Error(`Set DISPOSABLE_DATABASE_ACK=${DISPOSABLE_DATABASE_ACK_VALUE} hanya setelah memastikan target benar-benar disposable/staging.`);
  }

  const testDatabaseUrl = requireUrl(env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
  const testIdentity = databaseIdentity(testDatabaseUrl, 'TEST_DATABASE_URL');
  const protectedTargets = [
    ['DATABASE_URL', env.DATABASE_URL],
    ['MIGRATION_DATABASE_URL', env.MIGRATION_DATABASE_URL],
  ];
  for (const [label, value] of protectedTargets) {
    if (typeof value === 'string' && value.trim() && databaseIdentity(value, label) === testIdentity) {
      throw new Error(`TEST_DATABASE_URL harus berbeda dari target ${label}; target tidak ditampilkan.`);
    }
  }

  let testMigrationDatabaseUrl;
  if (requireMigration) {
    testMigrationDatabaseUrl = requireUrl(env.TEST_MIGRATION_DATABASE_URL, 'TEST_MIGRATION_DATABASE_URL');
    const migrationIdentity = databaseIdentity(testMigrationDatabaseUrl, 'TEST_MIGRATION_DATABASE_URL');
    if (migrationIdentity !== testIdentity) {
      throw new Error('TEST_MIGRATION_DATABASE_URL dan TEST_DATABASE_URL harus menunjuk ke database disposable yang sama.');
    }
    for (const [label, value] of protectedTargets) {
      if (typeof value === 'string' && value.trim() && databaseIdentity(value, label) === migrationIdentity) {
        throw new Error(`TEST_MIGRATION_DATABASE_URL harus berbeda dari target ${label}; target tidak ditampilkan.`);
      }
    }
  }

  return { testDatabaseUrl, testMigrationDatabaseUrl };
}

export function applyDisposableRuntimeDatabase(env, options = {}) {
  const targets = resolveDisposableDatabaseTargets(env, options);
  env.NODE_ENV = 'test';
  env.DATABASE_URL = targets.testDatabaseUrl;
  env.DATABASE_SSL = env.TEST_DATABASE_SSL ?? 'disable';
  return targets;
}

export function formatDisposableDatabaseError(error, fallback) {
  const message = error instanceof Error ? error.message.split('\n', 1)[0] : fallback;
  return message.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted database URL]');
}
