---
allowed-tools: Read, Bash, Glob, Grep, Task
description: Review the current local change with specialized reviewer agents — bugs, security, error handling, tests, conventions, types, docs — each on a model suited to it, and report merged findings
user-invocable: true
argument-hint: "[base-branch | commit-range] [focus]"
---

# /review-changes — Review the local change

Load the review-changes workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/review-changes/SKILL.md` and run it end to end. A
base branch or commit range, if the user named one, is in `$ARGUMENTS`, along
with anything they said about what to focus on or which reviewers to run; with
no scope given, review the working tree, else the branch's diff against its base.

This command only reviews: it never edits files, commits, pushes, or comments on
GitHub. Report the merged findings and stop — fix them only if the user asks.
