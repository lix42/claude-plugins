---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Plan a project or feature into per-task files with a dependency graph and a generated docs/TASKS.md
user-invocable: true
argument-hint: "[requirement or plan-doc path]"
---

# /tasks-setup — Plan a project into tasks

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Set up the
tasks** operation. `tasks` means `node ${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/cli/tasks.ts`. Read before writing any files:
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/task-file-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/tasks-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/progress-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/epics.md` — as soon as the
  split looks like it may need epics

The user's requirement is in `$ARGUMENTS`: inline text, a **path to a plan/design
doc**, or both (the path may be wrapped in prose like `read docs/plan.md and make
tasks`). If a path-like token resolves to a file, read it as the primary input. If
`$ARGUMENTS` is empty, ask what they want to build.

It is a conversation: understand the input, interview on what's unclear, converge on
a concise design, **pick flat or epic mode before proposing the split** (it decides
the ids), propose the tasks with a Mermaid dependency graph, and **get explicit
approval before writing any files**.

Then create the plan with the CLI — `tasks init [--epics] --title "<Project>"`,
the design in `docs/tasks/_header.md`, `tasks new` per task in dependency order,
each file's body filled in, each `_epic.md` given its scope — finish with
`tasks check`, and show `tasks ready`.
