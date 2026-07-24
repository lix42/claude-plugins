---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
description: Finish the current task and ship it — quality gates, code review, docs, mark task done, then open a PR or merge back linearly
user-invocable: true
args: none
---

# /ship — Ship the current change

Load the ship workflow at `${CLAUDE_PLUGIN_ROOT}/skills/ship/SKILL.md` and run it
end to end against the current working changes.

Invoking `/ship` is the user's go-ahead for the whole release flow (running checks,
pushing, opening a PR). Don't ask for step-by-step permission — but never proceed
past a failing quality gate, and don't merge a GitHub PR (leave the final merge to
the user). Work the steps in order and report a clear summary at the end.
