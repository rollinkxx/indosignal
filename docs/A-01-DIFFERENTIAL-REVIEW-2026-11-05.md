# A-01 Differential Security Review — 2026-11-05

## Scope

Review of the recovered DB-proof safety slice from commit `1f7e2a13fcd216adb6fb47caedd644d9db745e17`, applied against `origin/main` (`52887e6124880eb589f3f447b96bc9b40cb3213d`) on branch `audit/A-01-recover-review-2026-11-05`.

The recovered slice changes the disposable database guard, migration selection in test mode, DB proof scripts, and regression tests. It is not the complete remediation batch described in the historical handoff.

## Findings

### High — fixed before checkpoint: PostgreSQL URL query parameters could redirect the proof target

The recovered implementation originally compared only URL hostname, port, and pathname. The `pg` client accepts query parameters such as `host` and `port` as connection overrides. Therefore a URL whose visible authority pointed at a disposable host could still resolve to a different endpoint at runtime, while the identity guard compared the unmodified URL authority.

Reproduction against the installed `pg` version showed:

- `?host=prod-db.example` changes the effective host.
- `?port=6432` changes the effective port.

The helper now rejects connection-routing query keys (`host`, `hostaddr`, `port`, `dbname`, `service`, `options`, credentials, and related overrides) before any connection is opened. Five regression cases cover the routing variants.

### Low — fixed before checkpoint: raw proof errors could expose driver details

The proof scripts previously printed `error.stack`, which could expose connection details or implementation-specific driver output. A shared formatter now emits only the first error line and redacts PostgreSQL URLs. The restart proof also has an explicit sanitized failure handler.

## Review coverage

- Changed files reviewed: `docs/security-remediation.md`, `scripts/db-restart-proof.ts`, `scripts/disposable-database.d.mts`, `scripts/disposable-database.mjs`, `scripts/forward-test-db-proof.ts`, `scripts/migrate.mjs`, `scripts/multi-pair-scan-db-proof.ts`, `tests/db-proof-safety.test.ts`.
- Git history reviewed: recovered commit `1f7e2a1` and current `origin/main` baseline.
- Callers reviewed: restart proof, forward-test proof, multipair proof, and migration script.
- Test coverage added/verified: fail-closed behavior, explicit acknowledgement, runtime/migrator target separation, same disposable identity, routing-query rejection, and sanitized failure behavior.

## Verification evidence

- `corepack pnpm exec vitest run tests/db-proof-safety.test.ts` — 1 file, 19 tests passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm test` — 15 files, 120 tests passed.
- `corepack pnpm check:market-mocks` — passed.
- `corepack pnpm check:docker-security` — passed.
- `corepack pnpm build` — passed.
- `git diff --check` — passed.

## Boundaries

No PostgreSQL integration proof was run because the repository has no authorized disposable/staging database target. No production database, Hostless deployment, Docker daemon/image runtime, or external WORM storage was accessed. The recovered work therefore supports a source/test/build-level A-01 security checkpoint, not production or runtime acceptance of A-03–A-06.

## Review verdict

**Request human review / AWAITING APPROVAL.** The scoped recovered slice is suitable for review after the routing-parameter hardening and local verification above, but it must not be represented as the complete historical A-01 batch or as evidence that the database integration and deployment blockers are resolved.
