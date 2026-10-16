---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Mark a task complete and show what it just unblocked
user-invocable: true
argument-hint: "[task]"
---

# /tasks-done — Mark a task complete

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Mark a task
started or done** operation. `tasks` means `node ${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/cli/tasks.ts`.

The finished task is in `$ARGUMENTS` (the CLI accepts a unique name or substring;
confirm with the user if it reports an ambiguity). If it's empty, ask which task is
done.

1. `tasks set <id> status=done done="<YYYY-MM-DD> <PR, if any>"` (or `status=doing` if
   it's being started). This updates the frontmatter, the progress log's `Status`
   mirror and `TASKS.md`, and prints what became ready.
2. Close out the task's progress section with `tasks log <id> "…"`: the approach
   that landed, what's verified, and anything a dependent task should know.
3. In epic mode, update that epic's `## Epic summary` by hand if the task changed
   what *other* epics need to know. If nothing cross-cutting changed, leave it.
4. Report what the completion unblocked.
