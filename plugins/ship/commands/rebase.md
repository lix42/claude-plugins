---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
description: Rebase the current branch onto its base and adapt it to what changed upstream — small impacts automatically, large ones by decision — without pushing
user-invocable: true
argument-hint: "[base-branch]"
---

# /rebase — Rebase onto the base branch

Load the rebase workflow at `${CLAUDE_PLUGIN_ROOT}/skills/rebase/SKILL.md` and
run it end to end. A base branch, if the user named one, is in `$ARGUMENTS`;
with none given, use the current branch's pull-request base, else the default
branch.

Invoking `/rebase` is the user's go-ahead for rewriting the current branch's
local history and adapting its code to the base's changes. Don't ask for
step-by-step permission — but ask before stashing uncommitted work, put any
decision that changes what the branch is for to the user, and never push.
Report a clear summary at the end.
