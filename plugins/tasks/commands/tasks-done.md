---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Mark a task complete and show what it just unblocked
user-invocable: true
args: task - (optional) the task that's finished. If omitted, ask which one.
---

# /tasks-done — Mark a task complete

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Mark a task
done** operation.

The finished task is in `$ARGUMENTS` (fuzzy-match it against the task list;
confirm if ambiguous). If it's empty, ask which task is done.

Set its checkbox to `[x]` in `docs/TASKS.md` (use `[~]` if it's being started
rather than finished), then **run the what's-next query** and report any tasks the
completion just unblocked — that's the most useful thing to surface right after
finishing work.
