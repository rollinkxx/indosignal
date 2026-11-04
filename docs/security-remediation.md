# Security and operations runbook

## Database roles

`DATABASE_URL` is the application/runtime connection and must use a non-superuser role. The startup hook and `/api/ready` refuse readiness when the runtime role is a PostgreSQL superuser or required migrations are missing. `MIGRATION_DATABASE_URL` is separate and is used only by `scripts/migrate.mjs`; production must configure both values independently. The Docker entrypoint unsets `MIGRATION_DATABASE_URL` and `MIGRATION_DATABASE_SSL` before starting Next.js.

Provision the runtime role out of band with least privilege. The following is a starting template for a fresh schema; review table ownership and deployment-specific grants before applying:

```sql
CREATE ROLE indosignal_runtime LOGIN PASSWORD '<managed-secret>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE indosignal TO indosignal_runtime;
GRANT USAGE ON SCHEMA public TO indosignal_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO indosignal_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE indosignal_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO indosignal_runtime;

GRANT INSERT, UPDATE ON virtual_accounts, positions, forward_test_runs, multi_pair_scan_runs TO indosignal_runtime;
GRANT DELETE ON positions, api_rate_limit_buckets, api_request_leases TO indosignal_runtime;
GRANT INSERT, UPDATE, DELETE ON api_rate_limit_buckets TO indosignal_runtime;
GRANT INSERT, DELETE ON api_request_leases TO indosignal_runtime;
GRANT INSERT ON strategies, fee_configs, forward_test_candles, forward_test_events,
  forward_test_event_chain, paper_cash_ledger, decision_log, paper_orders, paper_fills,
  closed_trades, multi_pair_scan_observations TO indosignal_runtime;
```

Do not grant ownership, `TRUNCATE`, DDL, `DELETE` outside the narrowly listed mutable tables, or superuser to the runtime role. Forward-test candles/events, cash ledger, and hash-chain tables reject update/delete and `TRUNCATE` through database triggers. The migration role should be a separate credential in the deployment secret manager.

## Worker startup and recovery

The production Node instrumentation waits for PostgreSQL, verifies the runtime role and required migrations, then starts the two paper workers independently. Status endpoints do not start workers. Each worker owns a distinct PostgreSQL advisory lock and heartbeat. After restart, the durable candle cursor makes duplicate observations idempotent; a missing interval or candle later than the configured tolerance invalidates forward evidence instead of silently counting coverage. Never reset campaign state or delete evidence to recover a worker.

## API limits and proxy identity

Distributed API fixed-window buckets and concurrency leases require migration `0007_api_limits`. `TRUSTED_PROXY_HEADER` is optional and may only be set to a header that the hosting edge overwrites and strips from client input. `X-Forwarded-For` is deliberately not trusted. Without a configured trusted source, the limiter safely groups callers under a shared egress identity; configure the provider-overwritten header if per-client fairness is needed. The internal history diagnostic endpoint additionally requires a separate `ADMIN_DIAGNOSTIC_TOKEN` of at least 32 characters and has a low request/concurrency limit.

## Docker

The final image runs as UID 1001 (`nextjs`), contains production dependencies only, pins pnpm 10.34.5 and excludes environment files/private keys from the build context. Migrations run before the Next.js process; migrator variables are removed from the application process environment afterward.

## Audit chain and external anchoring

`forward_test_event_chain` provides an append-only per-run SHA-256 chain. Run `pnpm audit:chain` using a read-only audit database role to check event coverage and hashes; run `pnpm audit:db-integrity` for orphan rows, unvalidated constraints, duplicate keys, and ledger reconciliation. `pnpm audit:snapshot` writes a local HMAC-signed snapshot when `AUDIT_SNAPSHOT_HMAC_KEY` (32+ characters) and `AUDIT_SNAPSHOT_OUT` are configured; `pnpm audit:snapshot:verify` can validate it offline using `AUDIT_SNAPSHOT_FILE` and the same secret. Copy each snapshot to a separately administered immutable/WORM location. A database owner who can rewrite both the event table and chain can still reconstruct a consistent history. This repository does not configure or write to external immutable storage automatically; production rollout must provision that anchor separately.

## Operational test policy

Run the unit suite for pure logic. PostgreSQL proof scripts fail closed unless `DISPOSABLE_DATABASE_ACK=I_ACKNOWLEDGE_DISPOSABLE_DATABASE` and a dedicated disposable/staging `TEST_DATABASE_URL` are explicitly set. The restart proof also uses that validated target. Forward-test and multipair proofs additionally require `TEST_MIGRATION_DATABASE_URL`; it must point to the same disposable database as `TEST_DATABASE_URL`, use the test migrator credentials, and differ from any ambient runtime or migration database target. The proof runner validates targets before opening a connection or spawning migration/seed/verify children; URLs are never printed. `TEST_DATABASE_SSL` and `TEST_MIGRATION_DATABASE_SSL` control TLS for their respective roles. The acknowledgement is an operator confirmation, not proof that a target is disposable: verify the database identity and permissions independently, never use production, and keep proof data separate from live app state. Docker runtime identity checks require a built image and an available Docker daemon. Do not run migrations, load tests, or recovery tests against production without a separately approved change window.
