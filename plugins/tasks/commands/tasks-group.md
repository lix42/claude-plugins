---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Group an oversized flat task list into structural epics and split the progress log per epic
user-invocable: true
args: hint - (optional) grouping guidance, e.g. "keep the CLI work together" or a proposed epic list. If omitted, derive the grouping from the design and dependency structure.
---

# /tasks-group — Group tasks into epics

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Group tasks
into epics** operation.

**`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/epics.md` is authoritative
for this operation — read it and work its migration checklist step by step.** This
command is a summary, not a substitute: the checklist carries the exact outputs and
validation rules, and a migration done from memory leaves a mixed layout that later
operations refuse to touch. Also read, since the migration rewrites all three
formats:
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/tasks-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/progress-md-format.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/task-file-format.md` — for
  the relative-link depth rules the migration has to fix in every task file

Any grouping guidance from the user is in `$ARGUMENTS` — treat it as a strong
steer, but still check it against the structure of the code and the dependency
graph, and say so if it cuts across subsystems.

This promotes a flat plan to epic mode: `docs/tasks/<epic>/<task>.md`, ids renamed
to `<epic>/<task>`, and `docs/progress.md` split into `docs/progress/<epic>.md`.
There is no reverse operation.

Before anything else, **check the project is in coherent flat mode and the git
working tree is clean** — stop and say so if either fails, and treat a mixed
flat/epic layout as an interrupted migration to recover, not a plan to migrate. If
the plan is under the threshold in `epics.md` on both counts — task count *and*
subsystem spread — say it doesn't need epics and leave it alone.

**Group by structure** — subsystems, modules, layers — derived from the design's
architecture and the dependency clusters, corroborated by which files each task
actually touches. **Ignore existing phase/stage headings**: they group by delivery
and cut across subsystems, so reusing them produces incoherent epics. Aim for 3–10
tasks per epic.

**Propose the epic list — including each task's new id — and get explicit approval
before writing anything.** Because approval is a pause of unknown length, re-check
`HEAD` and `git status --porcelain` against what you recorded before proposing, and
abort if either moved rather than migrating from a stale reading.

Then work the checklist: `git mv` the task files, rewrite `TASKS.md` into its full
epic-mode shape (**including the generated epic rollup and the swapped progress-log
blockquote**), fix the relative links in every task file, and split the progress
log — each new file getting its header and an **`## Epic summary`**, log entries
moved verbatim under headings renamed to the bare task name, and anything that
names no task parked in `docs/progress/_unassigned.md` rather than forced into an
epic or dropped.

Finish by validating and reporting. The data-loss check is **set equality** between
the section titles you recorded up front and the task sections now spread across
the epic files plus `_unassigned.md`, **excluding the newly generated `Epic
summary` sections** — a raw count can never match and is not the check. Also
confirm every dependency id resolves to a real file, the **task** graph has no
cycles or dangling deps (rollup cycles are legitimate — don't flag them), and no
phase headings or `docs/progress.md` remain. **Stage everything with `git add -A`
and stop without committing** so the user reviews one diff.
