---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Plan a project or feature into a docs/TASKS.md + per-task files with a dependency graph
user-invocable: true
args: requirement - (optional) what to plan. May be inline requirement text, a path to a plan/design doc (e.g. `docs/plan.md`), or both. If omitted, ask.
---

# /tasks-setup — Plan a project into tasks

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Set up the
tasks** operation. Also read the format references it points to before writing
any files:
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/tasks-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/task-file-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/progress-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/epics.md` — read this as
  soon as the split looks like it may need epics

The user's requirement is in `$ARGUMENTS`. It may be inline text, a **path to a
plan/design doc**, or both — and the path may be wrapped in prose like
`read docs/plan.md` or `read docs/plan.md and make tasks`. In every case, pull out
any path-like token; if it resolves to an existing file, read that file as the
primary plan input and treat the rest of the argument as extra guidance. If
`$ARGUMENTS` is empty, ask the user to describe what they want to build.

Remember the operation is a conversation: understand the input, interview on what
is unclear, discuss and converge on a concise high-level design, propose the task
split with a Mermaid dependency graph, and **get explicit approval before writing
any files**.

**Pick flat or epic mode before proposing the split**, since it decides the task
ids. `epics.md` is authoritative on the threshold — either enough tasks or enough
separable subsystems tips it to epic mode; otherwise stay flat. Epics are
**structural** — parts of the system, derived from the design's architecture —
never delivery stages.

Then create the files and confirm:
- flat: `docs/TASKS.md`, `docs/tasks/<task>.md`, `docs/progress.md`
- epic: `docs/TASKS.md`, `docs/tasks/<epic>/<task>.md`, `docs/progress/<epic>.md`

Seed each progress file with the header from `progress-md-format.md` and one stub
`##` section per task — each with `Status: not started` and a one-line goal — so
every task already has a section to fill in as work begins. In epic mode, each
file also gets an `## Epic summary` placeholder above the task stubs.
