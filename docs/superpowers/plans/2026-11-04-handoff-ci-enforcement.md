# Handoff Update CI Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI fail for pull requests that change implementation/configuration without updating the durable task tracker, while exempting documentation-only changes.

**Architecture:** Add a pure, testable file-classification/check function in a small Node script. The CLI compares PR base/head SHAs with `git diff`; CI fetches full history and runs the check only for pull-request events. Tests pin the implementation-scope policy, and agent/README/handoff docs explain the enforced rule and its boundaries.

**Tech Stack:** Node.js 22 ESM, Vitest, GitHub Actions, pnpm 10.34.5. No new dependencies.

**Spec:** User request in the current conversation: make future-agent continuation more reliable than relying on instructions alone; ensure handoff updates persist in the repository and reduce repeated work when a Manus agent runs out of credits.

## Global Constraints

- Use `docs/AGENT-HANDOFF.md` as the required durable work/status file.
- A PR changing implementation/configuration must add or edit a task row in the handoff; documentation-only PRs are exempt from the automated requirement.
- Do not add dependencies or print/commit secrets, database URLs, or sensitive production details.
- CI check is read-only: it inspects the PR diff and must not mutate files or external systems.
- Do not claim deployment or production verification from a passing CI gate.

## Review Focus

- Source change without a handoff update fails with an actionable message.
- Source change with only a cosmetic/metadata edit to `docs/AGENT-HANDOFF.md` still fails; at least one task row must be added or edited.
- Source change with an added/edited task row in `docs/AGENT-HANDOFF.md` passes.
- Documentation-only change passes without requiring a tracker edit.
- Root operational config such as `package.json`, `Dockerfile`, or CI workflow is treated as implementation/configuration and requires a tracker update.
- Invalid/missing base/head SHA or unavailable Git diff fails closed with a useful diagnostic, not a silent pass.

---

### Task 1: Implement and test the handoff coverage classifier

**Files:**
- Create: `scripts/check-handoff-update.mjs`
- Create: `tests/handoff-update-check.test.ts`

**Interfaces:**
- Produces `checkHandoffCoverage(changedFiles, handoffDiff)` for unit tests and a CLI accepting `<base-sha> <head-sha>`.
- The CLI reads the full changed-file list (including deletions) and zero-context handoff diff between base/head; it exits non-zero for implementation/config changes unless an added handoff row matches `+| TASK-ID |`.

- [ ] **Step 1: Add failing unit tests** for: (a) app source without tracker fails; (b) app source plus only a timestamp/cosmetic tracker diff fails; (c) app source plus an added/edited task row passes; (d) README/docs-only changes pass without tracker; (e) `package.json`, `Dockerfile`, and `.github/workflows/ci.yml` without a task-row update fail; (f) empty file list passes.
- [ ] **Step 2: Run focused tests** with `corepack pnpm exec vitest run tests/handoff-update-check.test.ts`; confirm they fail because the checker module is absent.
- [ ] **Step 3: Implement the smallest pure classifier** with explicit implementation/config roots and critical root files; normalize path separators; detect `docs/AGENT-HANDOFF.md`; require an added diff line matching `/^\+\|\s*[A-Z][A-Z0-9]*-\d+\s*\|/`; and return `required`, `covered`, and an actionable `reason`.
- [ ] **Step 4: Implement the CLI**: require exactly two 40-character hexadecimal SHAs; run both the full changed-file `git diff --name-only` and `git diff --unified=0 -- docs/AGENT-HANDOFF.md`; print the decision; fail on invalid input, Git errors, or uncovered implementation changes; do not print environment variables or secret values.
- [ ] **Step 5: Re-run the focused tests** and require all cases to pass.
- [ ] **Step 6: Commit this slice** as `test: enforce handoff coverage rules` after updating the tracker row with the test result.

### Task 2: Wire the checker into package scripts and pull-request CI

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Package script: `check:handoff-update` invokes `node scripts/check-handoff-update.mjs`.
- Workflow supplies `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha` as arguments only on `pull_request` events.

- [ ] **Step 1: Add `check:handoff-update`** to `package.json` without changing dependency versions.
- [ ] **Step 2: Ensure checkout provides both PR commits** by setting `fetch-depth: 0` on the existing pinned `actions/checkout` step.
- [ ] **Step 3: Add a named CI step** after checkout/dependency setup that runs `pnpm check:handoff-update <base-sha> <head-sha>` only when `github.event_name == 'pull_request'`; use GitHub expression values in arguments, not shell-evaluated user text.
- [ ] **Step 4: Run the checker against this branch's base/head SHAs** and confirm it passes because this PR updates the handoff tracker.
- [ ] **Step 5: Commit the CI wiring** as `ci: require handoff updates for code PRs`, updating the tracker with exact evidence.

### Task 3: Document enforcement and recovery workflow

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/AGENT-HANDOFF.md`
- Modify: `.github/pull_request_template.md`
- Optionally modify: `docs/AGENT-RESUME-TEMPLATE.md` if its wording needs to distinguish CI-enforced from convention-only behavior.

- [ ] **Step 1: State in `AGENTS.md` and README** that code/config PRs must update the task tracker and that CI checks this; state docs-only changes are exempt from the automated gate.
- [ ] **Step 2: Add H-04** to the tracker with `IN PROGRESS`, branch, acceptance evidence, next action, and blocker; refresh the Resume snapshot before the implementation slice.
- [ ] **Step 3: Update the PR template** to show the tracker requirement and note that CI enforces it for implementation/config changes.
- [ ] **Step 4: Check links and policy wording** with a scripted file/reference check plus `git diff --check`.
- [ ] **Step 5: Run `corepack pnpm typecheck`, `corepack pnpm test`, and `corepack pnpm check:handoff-update <base-sha> <head-sha>`; let PR CI run the repository's full configured quality gates.
- [ ] **Step 6: Commit documentation** as `docs: document enforced handoff gate`; record command outputs/counts, CI URL/status, and exact next action in the handoff.

## Acceptance

- Unit tests cover all six review-focus cases and pass, including a failing cosmetic-only tracker edit.
- CLI fails closed on invalid input/Git errors and reports an uncovered code/config diff non-zero.
- CI runs the gate on PRs and passes this PR because H-04 has a real task-row update; a cosmetic tracker touch alone cannot pass.
- README, AGENTS, PR template, and handoff accurately distinguish automated enforcement from convention.
- The handoff records exact branch/commit/verification and remains linked from README.

## Execution Handoff

Review this plan before implementation. Task 1, Task 2, and Task 3 are sequential: the classifier/tests define the policy, CI wires it, and docs explain it. No deployment or production-data access is in scope.
