# Instructions for coding agents

This repository is the durable source of truth. A conversation link is supplementary context for intent and decisions; it does not prove that code, tests, or deployment changes exist in Git.

## Before work

1. Read `README.md`, `TODO.md`, this file, `docs/AGENT-RESUME-TEMPLATE.md`, and the **Resume snapshot** plus relevant tracker row in `docs/AGENT-HANDOFF.md`. Follow any additional repository documents referenced by those instructions.
2. Run `git fetch origin`, `git status --short --branch`, and inspect the current commit. Reconcile the snapshot with the actual checkout. If it is stale, update it before doing substantive work.
3. If a previous conversation is attached, read it for requirements, constraints, and decisions. Verify every claimed change against the current branch/commit; do not repeat completed, verified work or blindly copy partial patches.
4. Check the default branch, latest remote main, open PR/review/CI state, required checks, and branch protection before changing or merging work. Continue only the earliest unfinished task in the declared sequence.
5. Set the relevant tracker row to `IN PROGRESS` before implementation. For a new task, add an ID, scope, acceptance evidence, branch, and one concrete next action first.

## While working and when handing off

- Work in small, reviewable slices. After each meaningful slice, run the relevant check, update the tracker/checkpoint with changed files, branch and commit SHA, exact verification result, unverified boundaries, next action, and blocker; then commit and push the branch when access permits.
- Do not wait for a low-credit warning. Checkpoint at milestones. If context, time, or credit may run out, stop expanding scope, preserve safe work, record any failed or skipped verification, commit/push, and leave one concrete next action. If push is impossible, record why and the exact local SHA.
- Use `.github/pull_request_template.md` for PRs. Keep secrets and private operational values out of documentation, diffs, logs, and shell output.
- Every PR that changes implementation or operational configuration must add or edit a task row in `docs/AGENT-HANDOFF.md`. Pull-request CI enforces this and rejects timestamp-only/cosmetic tracker edits; documentation-only PRs are exempt. This gate proves only that a task row changed, not that code, deployment, or production behavior is correct.
- Never label work `DONE` based on code presence or a prior agent's report alone. Record the evidence and distinguish local tests, CI, deployment, and production observation.
- Use the handoff's formal status transitions. Routine task completion does not wait for discretionary human approval; mark work `DONE` when its acceptance criteria are verified and required checks pass. Respect any review explicitly required by repository branch-protection or ownership rules, but do not add a separate manual-approval gate. Deployment and other consequential external actions retain their own authorization requirements. Apply requested revisions to the same tracker task.
- Before ending, ensure the working tree and tracker agree. Use the concise final-report fields in `docs/AGENT-RESUME-TEMPLATE.md`; source claims from the PR/tracker evidence, report exact verification/counts and boundaries, and do not duplicate raw logs or create a second status record.

Detailed statuses, resume state, safety rules, and the copyable user-facing resume prompt are in `docs/AGENT-HANDOFF.md` and `docs/AGENT-RESUME-TEMPLATE.md`.
