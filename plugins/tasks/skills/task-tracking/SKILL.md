---
name: task-tracking
description: >-
  Plan and track development work as a docs/TASKS.md index plus docs/tasks/*.md
  files connected by a dependency graph. Use this whenever the user wants to
  break a feature or project into tasks, set up or write a plan/roadmap, asks
  "what should I work on next", "what's unblocked", "what can run in parallel",
  asks about the plan or remaining work, wants to add/remove/change/split tasks,
  or says they finished/completed a task or piece of work. Also use it when a
  docs/TASKS.md already exists and the user is discussing progress or next steps.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Task Tracking

A lightweight, file-based system for planning a project and knowing what to work
on next. The whole state lives in Markdown under `docs/` so it is diffable,
reviewable, and editable by hand — no database, no tool lock-in.

## The model

```
docs/
  TASKS.md              # index: design summary + dependency graph + task list
  tasks/
    <task-name>.md      # one file per task (kebab-case name)
  progress.md           # running execution log: how each task was carried out
  design.md             # optional: full design spec, only if it outgrows TASKS.md
```

`TASKS.md` is the control center. It has three parts, in this order:

1. **Design** — a concise high-level design so anyone (human or agent) can pick
   up the project without re-deriving intent. Keep it tight. If it grows large,
   move the detail to `docs/design.md` and leave a summary + link here.
2. **Dependencies** — the dependency graph. This is the **canonical source of
   truth** for what depends on what, because the "what's next" query reads it.
   It has a Mermaid diagram (for humans) and a machine-readable list (for the
   query). They must agree.
3. **Tasks** — the checklist. Each item links to its task file and carries a
   status box: `[ ]` not started · `[~]` in progress · `[x]` done. Tasks may be
   grouped into phases/stories when that helps tell the build story.

Each `tasks/<name>.md` file expands one task: its goal, the intended
design/approach, how to verify it, and which tasks it depends on. The per-task
Dependencies section mirrors the canonical list in `TASKS.md` for readability —
when they ever disagree, treat `TASKS.md` as authoritative and fix the mismatch.

`progress.md` is the **execution log** — a running narrative of *how* each task was
actually carried out: what was done, decisions made and why, what works, what
doesn't, and notes for dependent tasks. It's one file with one `##` section per
task (keyed by the kebab task name), which keeps it readable in one pass and
merge-friendly when tasks run in parallel. Where `TASKS.md` holds the authoritative
*status* and the task file holds the *spec*, `progress.md` holds the *story of the
work*. Read it before starting a task to learn what's done, what worked, and which
decisions were already made; update your task's section as you work. `/tasks-setup`
seeds it.

For the exact file layouts and copy-paste templates, read:
- `references/tasks-md-format.md` — TASKS.md structure (design, deps, task list)
- `references/task-file-format.md` — per-task file structure
- `references/progress-md-format.md` — progress.md structure (the execution log)

Read these before creating or editing files so the output stays consistent.

## Finding the docs directory

Tasks live at the **project root**, under `docs/`. Find the root by walking up
to the nearest `.git` (or an existing `docs/TASKS.md`). If you can't tell, or
there are multiple candidate roots, ask the user which project they mean rather
than guessing. Create `docs/` and `docs/tasks/` if they don't exist yet.

## Operations

This skill supports four operations. The user may invoke them explicitly via the
plugin commands (`/tasks-setup`, `/tasks-next`, `/tasks-update`, `/tasks-done`),
or describe them in natural language — pick the matching operation from intent.

### 1. Set up the tasks (plan a project)

Trigger: "plan this", "break this into tasks", "set up the tasks", "let's design
X and split the work". The user gives a requirement, which may or may not include
a design.

This operation is a **conversation, not a one-shot generation.** A plan the user
didn't help shape is a plan they won't trust. Work through it:

1. **Understand the input.** Read what the user gave you. If they pointed at
   existing code or docs, read those too.
2. **Interview.** Ask about anything genuinely unclear or unstated: scope and
   non-goals, target platform/tech stack, hard constraints, must-haves vs.
   nice-to-haves, and how "done" is judged. Ask only what you can't reasonably
   infer — don't interrogate. Prefer a few sharp questions over a long form.
3. **Discuss the design.** Propose a high-level design and talk it through. Push
   back if something seems off; surface trade-offs. Converge with the user.
4. **Propose the task split.** Present the final concise design, then a list of
   tasks — each with a one-line purpose — and the dependency edges between them.
   Show the dependency graph as a Mermaid diagram so it's easy to react to.
   - Good tasks are **independently implementable and verifiable**: roughly a
     single focused PR / a few hours of work. Avoid mega-tasks (split them) and
     avoid trivial fragments (fold them in).
   - Dependencies should be **real**: B depends on A when B needs a type, API,
     module, or behavior that A produces. Don't invent ordering that isn't there
     — false dependencies kill parallelism.
   - Group into phases/stories only when it clarifies the build order or each
     phase delivers something usable on its own.
5. **Get explicit approval.** Iterate until the user signs off. Do not write
   files before approval.
6. **Create the files.** Following the templates, write `docs/TASKS.md` (design +
   dependency graph + list), one `docs/tasks/<name>.md` per task, and
   `docs/progress.md` (the execution log). All tasks start `[ ]`. Seed
   `progress.md` with its header plus one stub `##` section per task — each with
   `Status: not started` and a one-line goal — so every task has a section ready
   to fill in.
7. **Confirm** what you created (counts, paths) and suggest running the "what's
   next" query to see the starting set.

### 2. What's next (query executable tasks)

Trigger: "what should I work on next", "what's unblocked / ready", "what can I
parallelize", "show me the plan status".

1. Read `TASKS.md`: each task's status and its dependencies (from the canonical
   Dependencies list).
2. A task is **executable** when it is `[ ]` not-started AND every dependency is
   `[x]` done. (`[~]` in-progress tasks are already being worked, so exclude them
   from "what to start" but report them separately.)
3. Report the executable set. For each, note what it unblocks.
4. **Suggest priority.** Rank by leverage: tasks that unblock the most
   downstream work first, and tasks on the longest dependency chain (the critical
   path) — finishing those keeps the project from stalling later.
5. **Suggest parallelism.** Among executable tasks, those that don't depend on
   each other can run in parallel. Flag when two otherwise-parallel tasks will
   likely fight over the same files/module, so the user can sequence them.
6. If **nothing** is executable: list in-progress tasks, and for the most
   valuable blocked tasks show exactly which unfinished dependencies are in the
   way. If there's no `TASKS.md` at all, say so and offer to run setup.

Before reporting, sanity-check the graph (see "Validate the graph"). If you find
a cycle or a dangling dependency, surface it — it usually means the next-task
answer can't be trusted until it's fixed.

When the user actually picks a task to start, read its `progress.md` section and
those of its dependencies first — they carry decisions and gotchas from the work
that came before.

### 3. Update the tasks

Trigger: "add a task for X", "we don't need Y anymore", "split Z into two",
"this task changed", "re-plan the rest".

Plans drift as you learn. Keep the files honest:

- **Add:** create `tasks/<name>.md`, add the item to the task list, and wire it
  into the Dependencies section (both the Mermaid diagram and the list) — its
  upstream deps and anything that should now depend on it.
- **Remove:** delete (or archive) the task file, remove it from the list and the
  Dependencies section, and **repair dependents** — any task that depended on the
  removed one must be re-pointed or explicitly freed, never left dangling.
- **Change / split / merge:** edit the task file(s) and sync `TASKS.md`. When
  splitting, decide how existing dependents and dependencies distribute across
  the new tasks.

After any change, **re-validate the graph** and keep the Mermaid diagram, the
canonical list, and the per-task Dependencies sections consistent. Confirm what
changed.

### 4. Mark a task done

Trigger: "I finished X", "X is done", "mark Y complete", "done with the parser".

1. Identify the task (fuzzy-match the name; confirm if ambiguous).
2. Set its checkbox to `[x]` in `TASKS.md`. If a task is being started rather
   than finished, use `[~]` instead.
3. **Close out the task's `progress.md` section:** set its `Status` to `done` (or
   `in progress` if you're starting it) and add a final dated entry capturing how
   it ended up — the approach that landed, what's verified working, and any note a
   dependent task needs. This is the record the next task will read.
4. **Then run the "what's next" query** and report any tasks the completion just
   unblocked. Finishing work is exactly when the user wants to know what opened
   up — closing this loop is the most useful thing you can do here.

## Validate the graph

Whenever you read or write the dependency graph, check:
- **No cycles** — A→B→A means neither can ever start; report it.
- **No dangling deps** — every referenced dependency names a task that exists.
- **Consistency** — the Mermaid diagram, the canonical list, and per-task
  Dependencies sections name the same edges.

A small project won't need tooling for this — reason over it directly. Only reach
for a script if a graph is large enough that manual tracing is error-prone.

## Principles

- **The files are the source of truth, not this conversation.** Always read the
  current `TASKS.md` before answering "what's next" or updating — it may have
  changed since you last saw it.
- **Keep edits surgical.** Touch only the lines that change; preserve the user's
  wording, ordering, and any phase structure.
- **Don't over-plan.** The plan is a tool for momentum, not a deliverable.
  Concise design, real dependencies, tasks sized to actually finish.
