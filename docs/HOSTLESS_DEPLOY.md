# Deploy Indo Signal ke Hostless

## Resource baseline

- PostgreSQL 17 managed database: `indosignal-db`, 0.25 vCPU, 512 MiB RAM, 512 MiB storage.
- App: Dockerfile build, satu replica, port `3000`, health probe `GET /api/ready`.
- Database secrets are linked separately: `DATABASE_URL` is the non-superuser runtime role and `MIGRATION_DATABASE_URL` is the DDL-capable migrator role. Never copy either secret to Git, chat, build logs, or browser-visible code.

## Migrations and startup

The container runs `node scripts/migrate.mjs` before Next.js starts. This script applies the idempotent PostgreSQL schema and records its version in `schema_migrations`. It creates no account, strategy, market data, or trading order. If the database is unreachable or the schema fails, startup stops instead of serving a partially configured instance. The app must run as one replica until shared-worker coordination and database transaction behavior are verified.

Migration `0004-forward-test` is additive and introduces durable forward-test evidence, cash ledger, and fill identifiers. After migration, the Node.js production instrumentation starts one paper-only worker. It uses a PostgreSQL session advisory lock so an overlapping process cannot run a second evaluator; the run cursor and all trade state remain in PostgreSQL across restarts. The worker evaluates only closed BTCIDR/1h candles received after its persisted `started_at`, polls at one-minute intervals, and invalidates the test on an unprovable data gap or late candle. The status endpoint is `/api/forward-test/status`.

The worker creates a virtual IDR 10,000,000 account only for the paper campaign. It uses public Indodax REST data and never submits real orders. Tax is not verified in the current pair contract, so results are explicitly pre-tax and this blocks activation even after the 14-day coverage criterion passes. A successful deployment starts the clock; no implementation/build/test run can count as forward-test data.

## Environment

Required in production: Hostless-managed `DATABASE_URL` and `MIGRATION_DATABASE_URL`, each with TLS enabled and certificate validation on. `DATABASE_URL` must use a non-superuser role; `MIGRATION_DATABASE_URL` is used only by the startup migrator and is not inherited by Next.js. Optional: `INDODAX_WS_TOKEN`; the app must not be considered authenticated WebSocket-live without it. Do not store secrets in repository files. Public market REST reads do not need private Indodax trading credentials.

## Release verification

1. Confirm the managed database is healthy and linked to the app.
2. Wait for successful build and migration logs; do not expose connection credentials in logs.
3. Verify `GET /api/ready` returns HTTP 200, then verify `/`, `/manifest.webmanifest`, `/api/market`, and a valid `/pasar/{pair}` route over HTTPS.
4. Verify malformed symbols fail safely and market outages show stale/error state rather than fabricated values.
5. Verify PWA install/offline shell on a real device; offline views must not present cached prices as live.
6. Keep paper strategy activation disabled. Private WebSocket and actual order execution require separate credentials, risk review, and testing; this deployment does not submit real orders.

## Rollback

Hostless can roll back the app deployment to the previous image. The initial schema is additive and does not migrate MySQL data; the new managed database starts empty. Back up any new persistent data before a later destructive schema change.
