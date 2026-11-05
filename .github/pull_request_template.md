## Task / handoff

- Tracker ID(s): <!-- e.g. A-01, H-03 -->
- Current tracker status: <!-- TODO | IN PROGRESS | BLOCKED | DONE -->
- Handoff updated in this PR: <!-- link docs/AGENT-HANDOFF.md section/row -->
- Branch and checkpoint commit: <!-- branch / SHA -->

For implementation or operational configuration changes, CI requires an added or edited task row in `docs/AGENT-HANDOFF.md`; a timestamp-only edit is insufficient. Documentation-only PRs are exempt.

## What changed and why

<!-- Keep scope and user impact explicit. Link a prior conversation only when it adds intent/decision context. -->

## Verification evidence

- Commands / checks: exact command, result, and test count where applicable:
- CI: required check name/status, run URL or ID, and evaluated head SHA:
- Not verified (deployment, database, live behavior, or other boundary):

## Resume point

- Next concrete action (or `None`):
- Blocker / required access (or `None`):

## Safety and scope

- [ ] No credentials, tokens, database URLs, or private operational values included.
- [ ] I distinguished code changes, local tests, CI, deployment, and production verification.
- [ ] If this is a continuation, I checked the repo state against the conversation and did not repeat verified work.

Before merge, verify the PR's required checks and branch-protection rules on GitHub; follow any review explicitly required by repository settings and never bypass a repository control. Routine task completion does not wait for discretionary review; mark a task `DONE` when its acceptance evidence is verified. Apply any requested revisions to the same tracker row. Deployment and other consequential external actions retain separate authorization requirements.
