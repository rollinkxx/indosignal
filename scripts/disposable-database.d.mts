export const DISPOSABLE_DATABASE_ACK_VALUE: string;

export function resolveDisposableDatabaseTargets(
  env: NodeJS.ProcessEnv,
  options?: { requireMigration?: boolean },
): { testDatabaseUrl: string; testMigrationDatabaseUrl?: string };

export function applyDisposableRuntimeDatabase(
  env: NodeJS.ProcessEnv,
  options?: { requireMigration?: boolean },
): { testDatabaseUrl: string; testMigrationDatabaseUrl?: string };
