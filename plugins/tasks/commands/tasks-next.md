---
allowed-tools: Read, Glob, Grep, Bash
description: Show which tasks are ready to work on now (deps satisfied), with priority and parallelism suggestions
user-invocable: true
argument-hint: "[epic]"
---

# /tasks-next — What's ready to work on

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **What's next**
operation. `tasks` means `node ${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/cli/tasks.ts`.

Run `tasks ready` — with `--epic $ARGUMENTS` when an epic is given, and then report
**only that epic**, plus at most one line on how many are ready elsewhere. Present
the ranked list with what each unblocks, add the parallelism advice the CLI can't
give (which ready tasks would touch the same files — read their task files), and
break near-ties toward an epic already in progress. If nothing is ready, say what
blocks the most valuable tasks (`tasks deps <id>`).

If there's no plan, say so and offer `/tasks-setup`; if the CLI says the plan
predates frontmatter, offer `/tasks-migrate`.

When the user picks a task, read the progress log first: in flat mode all of
`docs/progress.md`; in epic mode its whole `docs/progress/<epic>.md`, plus the
`Epic summary` of every epic it depends on.
