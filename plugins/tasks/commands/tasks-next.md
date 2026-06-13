---
allowed-tools: Read, Glob, Grep, Bash
description: Show which tasks are ready to work on now (deps satisfied), with priority and parallelism suggestions
user-invocable: true
args: none
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

When the user picks one of these to start, read its `docs/progress.md` section and
those of its dependencies first, so prior decisions and gotchas carry forward.
