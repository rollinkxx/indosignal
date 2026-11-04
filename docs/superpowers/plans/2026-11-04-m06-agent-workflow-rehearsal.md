# M-06 Agent Workflow Rehearsal Implementation Plan

> **For agentic workers:** Execute sequentially with one Manus agent only, as required by the user. Do not delegate. Use test-first steps and checkboxes.

**Goal:** Rehearse the agent workflow's recovery, handoff, validation, and completion paths using isolated temporary Git repositories, and record what the rehearsal does and does not prove.

**Architecture:** Vitest integration tests create temporary working repositories and local bare remotes, invoke Git and the real handoff checker, and assert task-state and snapshot transitions. No GitHub PRs, production services, credentials, market data, or persistent repository state are used by the fixtures.

**Tech Stack:** Node.js 22, pnpm 10.34.5, Vitest, TypeScript, Node filesystem/process APIs, and local Git.

**Spec:** `/home/ubuntu/upload/pasted_content.txt`, sections “M-06 — Simulasi Workflow Manus End-to-End” and “FINAL VERIFICATION”; repository instructions in `AGENTS.md` and `docs/AGENT-HANDOFF.md`.

## Global Constraints

- Follow one-agent, sequential execution; do not create subagents.
- Use temporary directories and local bare remotes only; no production/database/Hostless access or secrets.
- Do not create fake GitHub PRs or commits on the real `main` branch.
- Run each scenario with deterministic assertions and cleanup temporary directories even on failure.
- Describe fixture results as local workflow simulation, not proof of real GitHub Actions, production behavior, or autonomous model cognition.
- Maintain task-specific branch/PR, tracker, CI, and merge evidence for M-06.

## Review Focus

- Rename from an implementation path to a documentation path: the old path must still trigger handoff validation.
- Deletion of an implementation path: the removed path must still trigger handoff validation.
- Missing handoff and failing CI output must not reveal fixture secrets or private values.
- A blocked task must remain `BLOCKED`, never `DONE`, and must preserve a concrete blocker/next action.
- A fresh clone must recover branch, task, commit, status, and next action solely from repository files/Git; stale snapshot SHA must be detected against the observed branch SHA.

---

### Task 1: Close the rename/deletion handoff-gate gap found during rehearsal

**Files:**
- Modify: `scripts/check-handoff-update.mjs`
- Test: `tests/handoff-update-check.test.ts`
- Modify: `docs/AGENT-HANDOFF.md`

**Interfaces:**
- Consumes: `checkHandoffCoverage(changedFiles, handoffDiff)` and the CLI `<40-char-base-sha> <40-char-head-sha>`.
- Produces: CLI diff-path enumeration that includes both old and new paths for a rename, with the same exit-code contract.

- [ ] Add a temporary-repository regression test that renames `app/route.ts` to `docs/route.md` without a task-row update; assert checker exit code `1` and an implementation-path coverage error.
- [ ] Run `pnpm exec vitest run tests/handoff-update-check.test.ts`; confirm the rename test fails against current `git diff --name-only` behavior.
- [ ] Add a deletion regression test for `app/route.ts` without a handoff row; assert checker exit code `1`.
- [ ] Change CLI changed-path collection to `git diff --name-only --no-renames <range>` so source and destination paths remain visible.
- [ ] Run the focused tests and assert rename, deletion, existing missing-handoff, cosmetic-only, valid-row, invalid-SHA, missing-Git-context, and colored-output cases pass.
- [ ] Run `git diff --check` and record this discovered false-success gap in the M-06 tracker/evidence.

### Task 2: Rehearse the six workflow scenarios in isolated fixtures

**Files:**
- Create: `tests/agent-workflow-rehearsal.test.ts`
- Create: `docs/M-06-SIMULATION.md`
- Modify: `docs/AGENT-HANDOFF.md`

**Interfaces:**
- Consumes: Task 1's real handoff checker CLI, task-row format, status definitions, and Git history.
- Produces: deterministic Vitest cases and a scenario/evidence table with an explicit fixture-only boundary.

- [ ] Add a `simulatesNormalCompletionAndFreshCloneRecovery` test using a local bare remote: read fixture instructions, locate TODO, inspect Git, update tracker to `IN PROGRESS`, create a task branch, change a fixture source file, run its smoke test and handoff gate, commit/push, simulate a local merge, mark the fixture task `DONE`, then clone afresh and recover its status/commit/next action from Git and the handoff file.
- [ ] Add a `detectsCiFailureThenPassesAfterFix` test: make a deterministic fixture smoke check fail, assert the failure is visible and task is not `DONE`, fix the fixture, rerun the smoke check and gate, and assert success.
- [ ] Add a `preservesBlockedState` test: record a named dependency and next action, then assert no completion or merge transition occurs.
- [ ] Add a `reconcilesStaleSnapshotAgainstMain` test: store an old fixture SHA, advance fixture `main`, compare the recorded SHA to the observed branch SHA, update the snapshot, and assert equality.
- [ ] Add a `rejectsMissingHandoffWithoutLeakingSentinel` test: implementation-only diff fails the actual checker; assert its output does not contain a sentinel private value.
- [ ] Ensure every test cleans up its temporary worktree/bare remote in `finally`, including failing assertions.
- [ ] Run `pnpm exec vitest run tests/agent-workflow-rehearsal.test.ts tests/handoff-update-check.test.ts` and verify all six requested scenario categories plus rename/deletion behavior.
- [ ] Write `docs/M-06-SIMULATION.md` with scenario, exact test/command, result, and limits; state that the local bare remote is not a real GitHub PR or Actions run.
- [ ] Run `pnpm typecheck`, `pnpm test`, `pnpm check:market-mocks`, `pnpm check:docker-security`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- [ ] Run the actual handoff CLI against the exact M-06 base/head SHAs; commit, push, open the dedicated PR, verify CI/review/rules, merge only if allowed, and verify post-merge main CI.

## Self-review

All six M-06 scenarios are assigned explicit fixture tests; the rename/deletion false-success gap is handled first as a fail-first regression. The fixture suite is deterministic, offline, and isolated. Actual GitHub PR/Actions lifecycle remains verified only by the real M-06 PR/CI, while the scripted scenarios remain local simulation evidence. M-07 automation evaluation remains a separate task/plan after M-06 is complete.
