---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
description: Review the local change with specialized reviewer agents, fix the warranted findings, and re-review each round of fixes — widening the review to the code a fix could affect — until clean or the round cap
user-invocable: true
argument-hint: "[base-branch | commit-range] [focus] [--rounds <n>]"
---

# /review-fix-loop — Review, fix, and re-review the local change

Load the review-fix-loop workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/review-fix-loop/SKILL.md` and run it end to end. A
base branch or commit range, if the user named one, is in `$ARGUMENTS`, along
with anything they said about what to focus on, which reviewers to run, and a
`--rounds` re-review cap (a positive integer; the workflow uses 3 otherwise);
with no scope given, review the working tree, else the branch's diff against
its base.

This command edits the working tree only: it never commits, pushes, or comments
on GitHub. Leave the fixes uncommitted for the user to review.
