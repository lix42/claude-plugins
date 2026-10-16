---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
description: Drive an open GitHub PR to green — fix failing checks, rebase when behind, address, reply to and resolve review comments — without merging
user-invocable: true
argument-hint: "[pr-number-or-url] [--mark-ready]"
---

# /drive-pr — Drive a pull request to green

Load the drive-pr workflow at `${CLAUDE_PLUGIN_ROOT}/skills/drive-pr/SKILL.md`
and run it end to end. The pull request (a number or URL) and any `--mark-ready`
flag are in `$ARGUMENTS`; with no pull request given, use the current branch's.

Invoking `/drive-pr` is the user's go-ahead for pushing fixes to the pull
request's branch, replying to its comments, and resolving its review threads.
Don't ask for step-by-step permission — but never push past a failing quality
gate, and never merge the pull request. Report a clear summary at the end.
