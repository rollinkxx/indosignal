# Resume prompt for the next agent

Copy this prompt when continuing work in a fresh Manus session. Fill the conversation link and, if known, the task ID/priority. Attach the prior conversation for intent/rationale, but let the repository decide what is already done.

```text
Continue the work tracked in this repository. Previous conversation/context link: <PASTE LINK HERE>
Task or tracker ID (if known): <ID / title>

Use the repository as the source of truth for current implementation and progress; use the linked conversation only to recover requirements, constraints, and decision rationale. First read AGENTS.md, README.md, and the Resume snapshot/task row in docs/AGENT-HANDOFF.md. Fetch origin and inspect the actual branch, commit, working tree, and PR/CI state. Compare the conversation's claimed changes against Git and the tracker before acting. Do not redo verified work or assume uncommitted changes survived a session change.

Before coding, update/add the tracker row with IN PROGRESS, scope, acceptance evidence, and one concrete next action. Then resume only the unfinished work. After each meaningful slice, run and record the relevant verification, changed files, commit SHA, what remains unverified, next action, and blockers in docs/AGENT-HANDOFF.md; commit and push a recoverable checkpoint when possible. If blocked, record what exact access/environment/evidence would unblock it. Do not claim DONE without fresh evidence. Keep secrets out of the repository and logs.

At handoff, leave the Resume snapshot accurate and report branch/commit, verified result, and the next action.
```

## Recommended use of a conversation link

A previous-task link is valuable for nuance that a repository may not preserve: user intent, rejected approaches, assumptions, and decisions. It is not an execution checkpoint. Always inspect Git and CI first; use the conversation to fill gaps in rationale, then update the repo so the next agent does not need the conversation to know the current state.
