---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Plan a project or feature into a docs/TASKS.md + per-task files with a dependency graph
user-invocable: true
args: requirement - (optional) the requirement to plan; may include a high-level design. If omitted, ask.
---

# /tasks-setup — Plan a project into tasks

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Set up the
tasks** operation. Also read the format references it points to before writing
any files:
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/tasks-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/task-file-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/progress-md-format.md`

The user's requirement is in `$ARGUMENTS` (it may or may not include a design).
If it's empty, ask the user to describe what they want to build.

Remember the operation is a conversation: understand the input, interview on what
is unclear, discuss and converge on a concise high-level design, propose the task
split with a Mermaid dependency graph, and **get explicit approval before writing
any files**. Then create `docs/TASKS.md`, `docs/tasks/*.md`, and `docs/progress.md`, and confirm.

When writing `docs/progress.md`, seed it with the header from `progress-md-format.md`
and one stub `##` section per task created — each with `Status: not started` and a
one-line goal — so every task already has a section to fill in as work begins.
