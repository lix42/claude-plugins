---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Add, remove, split, or change tasks and keep the dependency graph consistent
user-invocable: true
args: change - (optional) describe the change, e.g. "add a task for X", "drop Y", "split Z", "move W into the color epic". If omitted, ask.
---

# /tasks-update — Change the plan

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Update the
tasks** operation. Read the format references before editing files:
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/tasks-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/task-file-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/epics.md` — if the plan is
  in epic mode, or the change moves a task between epics

The requested change is in `$ARGUMENTS`. If it's empty, ask what should change.

Apply the change to the task file(s) and to `docs/TASKS.md`, then re-validate the
dependency graph (no cycles, no dangling deps) and keep the Mermaid diagram, the
canonical dependency list, the epic rollup, and per-task Dependencies sections in
sync. When removing a task, repair anything that depended on it. When adding one,
give it a stub section in the right progress file. Confirm what changed.

**Moving a task between epics renames it**, so do the whole rename: `git mv` the
file, rewrite the id in the dependency list (its own entry *and* every entry that
names it), the diagram, and the task list; fix the relative links in its
Dependencies section and in every file linking to it; and move its progress section
verbatim into the new epic's file.

If a flat plan has outgrown itself — past the threshold in `epics.md`, or the
progress log is getting unwieldy — mention that `/tasks-group` can reorganize it
into epics. Offer it; don't migrate as a side effect of an unrelated update.
