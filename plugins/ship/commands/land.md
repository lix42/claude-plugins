---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, Skill
description: Alias for /ship:ship — finish the current task and ship it (rebase, quality gates, code review, mark task done, then open a PR or merge back linearly)
user-invocable: true
argument-hint: "[--skip-gates] [--skip-review]"
---

# /land — Ship the current change

`/land` is an alias for `/ship:ship`, named so autocomplete doesn't send it to
Claude Code's built-in `/ship`. It behaves exactly like `/ship:ship`.

Load the ship workflow at `${CLAUDE_PLUGIN_ROOT}/skills/ship/SKILL.md` and run it
end to end against the current working changes. Any `--skip-gates` or
`--skip-review` flag is in `$ARGUMENTS`; the workflow says when each applies.

Invoking `/land` is the user's go-ahead for the whole release flow (running checks,
pushing, opening a PR). Don't ask for step-by-step permission — but never proceed
past a failing quality gate, and don't merge a GitHub PR (leave the final merge to
the user). Work the steps in order and report a clear summary at the end.
