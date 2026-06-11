---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Add, remove, split, or change tasks and keep the dependency graph consistent
user-invocable: true
args: change - (optional) describe the change, e.g. "add a task for X", "drop Y", "split Z". If omitted, ask.
---

# /tasks-update — Change the plan

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Update the
tasks** operation. Read the format references before editing files:
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/tasks-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/task-file-format.md`

The requested change is in `$ARGUMENTS`. If it's empty, ask what should change.

Apply the change to the task file(s) and to `docs/TASKS.md`, then re-validate the
dependency graph (no cycles, no dangling deps) and keep the Mermaid diagram, the
canonical dependency list, and per-task Dependencies sections in sync. When
removing a task, repair anything that depended on it. Confirm what changed.
