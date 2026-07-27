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
rather than finished). Epic status is derived from its tasks, so there's nothing
separate to update there.

Then **close out the task's progress section** — `docs/progress.md` in flat mode,
`docs/progress/<epic>.md` in epic mode: set its `Status` to `done` and add a final
dated entry on how it landed — the approach that worked, what's verified, and
anything a dependent task should know.

In epic mode, also **update that file's `Epic summary`** if the task changed what
*other* epics need to know: a new or changed interface, a decision that constrains
callers, a known gap. Dependent epics read the summary instead of the detail, so
leaving it stale actively misleads. If nothing cross-cutting changed, leave it.

Finally, **run the what's-next query** and report any tasks the completion just
unblocked — that's the most useful thing to surface right after finishing work.
