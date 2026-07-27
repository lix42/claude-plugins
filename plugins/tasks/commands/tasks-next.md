---
allowed-tools: Read, Glob, Grep, Bash
description: Show which tasks are ready to work on now (deps satisfied), with priority and parallelism suggestions
user-invocable: true
args: epic - (optional) limit the report to one epic. If omitted, cover the whole plan.
---

# /tasks-next — What's ready to work on

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **What's next
(query executable tasks)** operation.

Read the current `docs/TASKS.md`, find the tasks that are not started and have all
dependencies done, and report them — with a suggested priority (favor tasks that
unblock the most downstream work and sit on the critical path) and which tasks can
run in parallel. If nothing is executable, explain what's blocking the most
valuable tasks. If there's no `docs/TASKS.md`, say so and offer to run
`/tasks-setup`.

Detect flat vs epic mode as the skill describes, and stop if the layout is mixed.
In epic mode, read the **task-level** dependency list — not the epic rollup, which
is coarser and would report false blocks — and group the report by epic. Break
near-ties in priority toward an epic that's already in progress, since staying in
one part of the system beats context-switching.

If `$ARGUMENTS` names an epic, **report only that epic** — that's the whole point
of scoping the query, and on a large plan an unrequested whole-plan dump is the
context cost epics exist to remove. Add at most one closing line noting how many
tasks are ready elsewhere, so the user knows the rest exists and can ask. If
nothing in that epic is executable, say what's blocking it rather than silently
widening the search.

When the user picks a task to start, read the progress log first so prior decisions
and gotchas carry forward: in flat mode all of `docs/progress.md`; in epic mode its
whole `docs/progress/<epic>.md`, plus the `Epic summary` of every epic it depends
on.
