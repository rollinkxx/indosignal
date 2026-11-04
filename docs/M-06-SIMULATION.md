# M-06 — Agent Workflow Simulation

## Purpose and boundary

This report records a deterministic, local rehearsal of the repository's task recovery, handoff, validation, review-state, and completion workflow. All scripted scenarios create temporary working repositories and local bare Git remotes under the operating-system temporary directory and remove them in `finally` blocks. They do not create GitHub PRs, use production data or credentials, connect to PostgreSQL/Hostless, or prove autonomous model cognition.

The real M-06 PR and its GitHub Actions run are tracked separately in `docs/AGENT-HANDOFF.md`. A green local fixture is not evidence that GitHub Actions, production deployment, or live application behavior works.

## Scenarios and evidence

| Scenario | Test | Result | What is asserted |
|---|---|---|---|
| A. Normal completion | `simulates normal completion and fresh-clone recovery with review gating` | Pass | Reads fixture `AGENTS.md`/`TODO.md`, inspects clean Git state, records `IN PROGRESS`, creates a task branch, changes a source file, runs smoke and actual handoff checks, pushes to a local bare remote, preserves `AWAITING APPROVAL` until review evidence is recorded, simulates a local merge, then records `DONE`. |
| B. CI failure and repair | `detects a CI failure, keeps the task open, and passes after a fix` | Pass | A deterministic smoke command first exits nonzero; task remains `IN PROGRESS`. After the fixture source is repaired, smoke and the actual handoff checker pass; task remains `AWAITING APPROVAL`, not `DONE`. |
| C. Blocked task | `preserves a named blocker and does not transition to DONE or merge` | Pass | A concrete dependency and resume action remain recorded as `BLOCKED`; no task branch is merged and no `DONE` transition occurs. |
| D. Session recovery | Included in the normal-completion test | Pass | A fresh clone recovers the task ID/status, task branch, implementation commit, review evidence, and next action from Git and the handoff file without prior conversation context. |
| E. Stale snapshot | `detects and reconciles a stale main SHA in the resume snapshot` | Pass | Detects that a recorded main SHA differs from observed `main`, updates the snapshot to the observed SHA, and verifies the recorded SHA is an ancestor of the resulting branch. |
| F. Missing handoff | `rejects a missing handoff without leaking a source-file sentinel` | Pass | The real checker exits `1` for an implementation-only change, while a sentinel in source-file contents is absent from its diagnostic output and the task stays `TODO`. |
| Rename/deletion regressions | `tests/handoff-update-check.test.ts` | Pass | Source-to-documentation rename and implementation deletion both fail the coverage gate without a task-row update. |
| M-04 status/error-output regressions | `tests/handoff-update-check.test.ts` | Pass | `AWAITING APPROVAL` task-row syntax is accepted without claiming semantic validation; a sentinel emitted on Git stderr is suppressed from the checker diagnostic. |

## Commands and local results

The fail-first rename regression was run before the checker fix:

```sh
corepack pnpm exec vitest run tests/handoff-update-check.test.ts -t 'implementation-to-documentation rename'
```

It failed as expected (1 failed, 19 skipped): the checker returned exit code `0` because `git diff --name-only` reported only the documentation destination. The fix uses `git diff --name-only --no-renames`, preserving both changed paths for classification.

Focused rehearsal and checker tests:

```sh
corepack pnpm exec vitest run tests/agent-workflow-rehearsal.test.ts tests/handoff-update-check.test.ts
```

Result: 2 test files passed, 27 tests passed.

Full repository quality gates on the M-06 working tree:

| Command | Result |
|---|---|
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm test` | 14 files passed, 101 tests passed |
| `corepack pnpm check:market-mocks` | Passed: market mock guard clean |
| `corepack pnpm check:docker-security` | Passed: static Docker security checks |
| `corepack pnpm build` | Passed: optimized Next.js production build |
| `corepack pnpm audit --audit-level high` | Passed: no known vulnerabilities found |
| `git diff --check` | Passed |

Toolchain used: Node.js `v22.23.4`, pnpm `10.34.5` (the repository-pinned version).

## Remaining verification

At the time this report was written, the dedicated M-06 GitHub PR, its required-check/review state, merge result, and post-merge `main` CI were still pending. Those results must be added to the handoff and this report only after fresh GitHub verification. No production deployment, database integration, live market data, or production behavior was tested or claimed here.
