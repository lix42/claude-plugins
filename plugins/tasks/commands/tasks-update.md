---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Add, remove, split, rename, or change tasks and keep the dependency graph consistent
user-invocable: true
args: change - (optional) describe the change, e.g. "add a task for X", "drop Y", "split Z", "move W into the color epic". If omitted, ask.
---

# /tasks-update — Change the plan

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Update the
tasks** operation. `tasks` means `node ${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/cli/tasks.ts`. Read
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/task-file-format.md` before
editing task files.

The requested change is in `$ARGUMENTS`. If it's empty, ask what should change.

Use the CLI for every structural change — `tasks new`, `tasks set <id> deps+=… deps-=…
status=closed closed_into=…`, `tasks mv <old> <new>` for a rename or a move between
epics — and edit task bodies directly. Never edit `docs/TASKS.md`; the CLI
regenerates it. When removing a task, prefer closing it; if a file must go, repair
its dependents (`tasks unblocks <id>`). Finish with `tasks check` and confirm what
changed.

If a flat plan has crossed the threshold in `references/epics.md`, mention that
`/tasks-group` can reorganise it. Offer it; don't do it as a side effect.
