# Resume prompt for the next agent

Copy this prompt when continuing work in a fresh Manus session. Fill the conversation link and, if known, the task ID/priority. Attach the prior conversation for intent/rationale, but let the repository decide what is already done.

```text
Continue the work tracked in this repository. Previous conversation/context link (context only): <PASTE LINK HERE>
Task or tracker ID (if known): <ID / title>

Repository recovery protocol:
1. Read AGENTS.md, README.md, TODO.md, docs/AGENT-HANDOFF.md (Resume snapshot and relevant tracker row), docs/AGENT-RESUME-TEMPLATE.md, and any additional documents referenced by those instructions.
2. Fetch origin. Record default branch and latest origin/main SHA; inspect current branch, HEAD, working tree, recent commits, open PRs, reviews, CI checks, required checks, branch protection, and relevant issue/tracker state. Do not assume old conversation evidence is current.
3. Compare the Resume snapshot and attached conversation claims against Git, GitHub PR/CI, and the task tracker. Reconcile stale snapshot claims before substantive work. Do not redo verified work or assume uncommitted changes survived a session change.
4. Continue only the earliest unfinished task in the repository's declared sequence. Before implementation, set/add the tracker row to IN PROGRESS with scope, acceptance evidence, branch, and one concrete next action.
5. Work on a task-specific branch and PR. Run relevant checks, record exact commands/results and test counts, distinguish verified from unverified claims, and commit/push a recoverable checkpoint after each meaningful slice. Never bypass required reviews, branch protection, or security controls.
6. If blocked, record the exact dependency and what would unblock it. Do not claim DONE without fresh evidence that acceptance criteria are met. Keep secrets and private operational values out of the repository and logs.
7. At handoff, update the Resume snapshot with last reconciled timestamp/time zone/main SHA, active task/status/branch/commit, one immediate next action, correct next priority, last known verification, current blockers, and a conversation link for context only. Report the recorded branch/commit and verification boundaries.
```

## Recommended use of a conversation link

A previous-task link is valuable for nuance that a repository may not preserve: user intent, rejected approaches, assumptions, and decisions. It is not an execution checkpoint. Always inspect Git and CI first; use the conversation to fill gaps in rationale, then update the repo so the next agent does not need the conversation to know the current state.
