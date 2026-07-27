---
name: task-tracking
description: >-
  Plan and track development work as a docs/TASKS.md index plus docs/tasks/*.md
  files connected by a dependency graph, optionally grouped into epics. Use this
  whenever the user wants to break a feature or project into tasks, set up or
  write a plan/roadmap, asks "what should I work on next", "what's unblocked",
  "what can run in parallel", asks about the plan or remaining work, wants to
  add/remove/change/split tasks, wants to group tasks into epics or reorganize a
  plan that has grown too big, or says they finished/completed a task or piece of
  work. Also use it when a docs/TASKS.md already exists and the user is discussing
  progress or next steps.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Task Tracking

A lightweight, file-based system for planning a project and knowing what to work
on next. The whole state lives in Markdown under `docs/` so it is diffable,
reviewable, and editable by hand — no database, no tool lock-in.

## The model

A plan is in one of two modes. **Flat** is the default; **epic** adds a second
level of grouping once the plan is too big to read in one pass.

```
Flat mode                          Epic mode
docs/                              docs/
  TASKS.md                           TASKS.md
  tasks/                             tasks/
    <task>.md                          <epic>/<task>.md
  progress.md                        progress/
  design.md                            <epic>.md
                                     design.md
```

`TASKS.md` is the control center in both modes — always one file. It has three
parts, in this order:

1. **Design** — a concise high-level design so anyone (human or agent) can pick
   up the project without re-deriving intent. Keep it tight. If it grows large,
   move the detail to `docs/design.md` and leave a summary + link here.
2. **Dependencies** — the dependency graph, at the **task** level. This is the
   **canonical source of truth** for what depends on what, because the "what's
   next" query reads it. It has a Mermaid diagram (for humans) and a
   machine-readable list (for the query). They must agree. In epic mode a derived
   epic-rollup diagram sits above them for the big picture.
3. **Tasks** — the checklist. Each item links to its task file and carries a
   status box: `[ ]` not started · `[~]` in progress · `[x]` done. In epic mode
   the list is grouped under `###` epic headings.

Each task file expands one task: its goal, the intended design/approach, how to
verify it, and which tasks it depends on. The per-task Dependencies section
mirrors the canonical list in `TASKS.md` for readability — when they ever
disagree, treat `TASKS.md` as authoritative and fix the mismatch.

The **progress log** is the execution record — a running narrative of *how* each
task was actually carried out: what was done, decisions made and why, what works,
what doesn't, and notes for dependent tasks. One `##` section per task. In flat
mode that's a single `docs/progress.md`; in epic mode it's one
`docs/progress/<epic>.md` per epic, each opening with a curated `## Epic summary`
of what other epics need to know. Where `TASKS.md` holds the authoritative
*status* and the task file holds the *spec*, the progress log holds the *story of
the work*. Read it before starting a task; update your task's section as you work.
The setup operation seeds it.

### Detect the mode first, and fail closed

Before reading or writing anything, determine the mode from the **whole layout**,
not one signal:

- **Flat** — `docs/progress.md` exists, `docs/tasks/` holds only files, no
  `docs/progress/`.
- **Epic** — `docs/progress/` exists, `docs/tasks/` holds only subdirectories, no
  `docs/progress.md`.
- **Mixed** — anything else. **Stop and report it**; do not guess a mode and keep
  writing. A mixed layout is almost always an interrupted migration, and treating
  it as epic mode means writing to the wrong progress file. `references/epics.md`
  has the recovery path.

Then stay in that mode. Both are fully supported — a flat project is not a broken
project. Operation 5 promotes a flat plan to epic mode; there is no reverse
operation.

For the exact file layouts and copy-paste templates, read:
- `references/tasks-md-format.md` — TASKS.md structure (design, deps, task list)
- `references/task-file-format.md` — per-task file structure
- `references/progress-md-format.md` — progress log structure, both modes
- `references/epics.md` — when to use epics, how to group, how to migrate

Read these before creating or editing files so the output stays consistent.

## Finding the docs directory

Tasks live at the **project root**, under `docs/`. Find the root by walking up
to the nearest `.git` (or an existing `docs/TASKS.md`). If you can't tell, or
there are multiple candidate roots, ask the user which project they mean rather
than guessing. Create `docs/` and `docs/tasks/` if they don't exist yet.

## Operations

This skill supports five operations. In Codex, `$task-tracking` handles all of
them; choose the operation from the user's request. Claude Code also exposes the
`/tasks-setup`, `/tasks-next`, `/tasks-update`, `/tasks-done`, and `/tasks-group`
wrappers, which route to this same workflow. Natural-language requests work on
either host.

### 1. Set up the tasks (plan a project)

Trigger: "plan this", "break this into tasks", "set up the tasks", "let's design
X and split the work". The user gives a requirement, which may or may not include
a design.

This operation is a **conversation, not a one-shot generation.** A plan the user
didn't help shape is a plan they won't trust. Work through it:

1. **Understand the input.** Read what the user gave you. The input may be inline
   requirement text, **a path to a plan/design doc**, or both — and a path may be
   wrapped in prose (`read docs/plan.md`, `read docs/plan.md and make tasks`).
   Pull out any path-like token; if it resolves to an existing file, read that
   file as the primary plan and treat the rest as extra guidance. If they pointed
   at existing code or other docs, read those too.
2. **Interview.** Ask about anything genuinely unclear or unstated: scope and
   non-goals, target platform/tech stack, hard constraints, must-haves vs.
   nice-to-haves, and how "done" is judged. Ask only what you can't reasonably
   infer — don't interrogate. Prefer a few sharp questions over a long form. When
   the user handed you a worked-out plan doc, interview *lighter*: the plan is
   input to the conversation, not a license to skip it — reflect the design back
   concisely, ask only about real gaps, and still get approval before writing.
3. **Discuss the design.** Propose a high-level design and talk it through. Push
   back if something seems off; surface trade-offs. Converge with the user.
4. **Decide flat or epic — before proposing the split.** Sketch the tasks roughly,
   then pick the mode, because the mode determines the ids you're about to
   propose. Use **epic mode** when the split will yield **more than ~12 tasks** or
   the work spans **3+ separable subsystems** — either one is enough; otherwise
   stay flat. When you go epic, derive the epics from the design's architecture —
   they are parts of the system, never delivery stages. Read `references/epics.md`
   before deciding; it is authoritative on the threshold.
5. **Propose the task split.** Present the final concise design, then the tasks —
   each with a one-line purpose — and the dependency edges between them. Show the
   dependency graph as a Mermaid diagram so it's easy to react to. In epic mode,
   present the epics first with a one-line scope each, then the tasks under them.
   - Good tasks are **independently implementable and verifiable**: roughly a
     single focused PR / a few hours of work. Avoid mega-tasks (split them) and
     avoid trivial fragments (fold them in).
   - Dependencies should be **real**: B depends on A when B needs a type, API,
     module, or behavior that A produces. Don't invent ordering that isn't there
     — false dependencies kill parallelism.
   - Epics should be **structural**: 3–10 tasks that share code and concepts.
6. **Get explicit approval.** Iterate until the user signs off. Do not write
   files before approval.
7. **Create the files.** Following the templates, write `docs/TASKS.md` (design +
   dependency graph + list), one file per task, and the progress log. All tasks
   start `[ ]`. Seed the log with its header plus one stub `##` section per task —
   each with `Status: not started` and a one-line goal — so every task has a
   section ready to fill in. In epic mode that's one `docs/progress/<epic>.md` per
   epic, each with an `## Epic summary` placeholder above the task stubs.
   - If the user supplied a plan/design doc, **distill** a concise summary into
     TASKS.md's Design section and link back to the source doc — don't move,
     overwrite, or copy it wholesale. Keep TASKS.md self-contained while
     preserving the original research where the user put it.
8. **Confirm** what you created (counts, paths) and suggest running the "what's
   next" query to see the starting set.

### 2. What's next (query executable tasks)

Trigger: "what should I work on next", "what's unblocked / ready", "what can I
parallelize", "show me the plan status". The user may scope it to one epic —
"what's next in `color`" — in which case report that epic first and the rest
briefly.

1. Read `TASKS.md`: each task's status and its dependencies (from the canonical
   Dependencies list). Read the **task-level** graph, not the epic rollup — the
   rollup is coarser and would report false blocks.
2. A task is **executable** when it is `[ ]` not-started AND every dependency is
   `[x]` done. (`[~]` in-progress tasks are already being worked, so exclude them
   from "what to start" but report them separately.)
3. Report the executable set, grouped by epic when in epic mode. For each, note
   what it unblocks.
4. **Suggest priority.** Rank by leverage: tasks that unblock the most
   downstream work first, and tasks on the longest dependency chain (the critical
   path) — finishing those keeps the project from stalling later. In epic mode,
   break near-ties toward an epic that is already in progress: staying in one part
   of the system is cheaper than context-switching across two.
5. **Suggest parallelism.** Among executable tasks, those that don't depend on
   each other can run in parallel. Flag when two otherwise-parallel tasks will
   likely fight over the same files/module, so the user can sequence them. Tasks
   in *different* epics are the safer parallel bets, since epics are structural —
   but check, because cross-epic tasks can still meet at a shared interface.
6. If **nothing** is executable: list in-progress tasks, and for the most
   valuable blocked tasks show exactly which unfinished dependencies are in the
   way. If there's no `TASKS.md` at all, say so and offer to run setup.

Before reporting, sanity-check the graph (see "Validate the graph"). If you find
a cycle or a dangling dependency, surface it — it usually means the next-task
answer can't be trusted until it's fixed.

When the user actually picks a task to start, read the progress log first — it
carries decisions and gotchas from the work that came before. In flat mode, read
**all of `docs/progress.md`** — a flat plan is small enough that reading it whole
is the point, and paying that cost is exactly what epic mode exists to avoid. In
epic mode, read the task's **whole epic file**, plus the `Epic summary` of every
epic it depends on.

### 3. Update the tasks

Trigger: "add a task for X", "we don't need Y anymore", "split Z into two",
"move W into the `color` epic", "this task changed", "re-plan the rest".

Plans drift as you learn. Keep the files honest:

- **Add:** create the task file (in epic mode, under the epic that owns the code
  it changes), add the item to the task list, add a stub section to the epic's
  progress file, and wire it into the Dependencies section (both the Mermaid
  diagram and the list) — its upstream deps and anything that should now depend
  on it.
- **Remove:** delete (or archive) the task file, remove it from the list and the
  Dependencies section, and **repair dependents** — any task that depended on the
  removed one must be re-pointed or explicitly freed, never left dangling.
- **Change / split / merge:** edit the task file(s) and sync `TASKS.md`. When
  splitting, decide how existing dependents and dependencies distribute across
  the new tasks.
- **Move between epics** (epic mode): this renames the task, so do all of it —
  `git mv` the file, rewrite the id in the dependency list (its own entry *and*
  every entry naming it), the diagram, and the task list; fix the relative links
  in that task's Dependencies section and in every file linking to it; and move
  its progress section verbatim to the new epic's file. See `references/epics.md`.
- **Add or remove an epic:** an epic is just a directory, a progress file, and a
  heading — but every task under it is renamed, so treat it with the same care as
  a move. Removing an epic means redistributing its tasks, not deleting them.

After any change, **re-validate the graph** and keep the Mermaid diagram, the
canonical list, the epic rollup, and the per-task Dependencies sections
consistent. Confirm what changed.

If the plan has outgrown flat mode — it crossed the threshold in
`references/epics.md`, or the log is getting unwieldy — mention that operation 5
can group it into epics. Offer; don't do it as a side effect of an unrelated
update.

### 4. Mark a task done

Trigger: "I finished X", "X is done", "mark Y complete", "done with the parser".

1. Identify the task (fuzzy-match the name; confirm if ambiguous).
2. Set its checkbox to `[x]` in `TASKS.md`. If a task is being started rather
   than finished, use `[~]` instead. Epic status is derived — there's nothing
   separate to update.
3. **Close out the task's progress section:** set its `Status` to `done` (or
   `in progress` if you're starting it) and add a final dated entry capturing how
   it ended up — the approach that landed, what's verified working, and any note a
   dependent task needs. This is the record the next task will read.
4. **Update the `Epic summary`** (epic mode) if the task changed what another epic
   needs to know — a new or changed interface, a decision that constrains callers,
   a known gap. Dependent epics read the summary *instead of* the detail, so a
   stale summary actively misleads. Nothing cross-cutting to report is fine; say
   nothing then.
5. **Then run the "what's next" query** and report any tasks the completion just
   unblocked. Finishing work is exactly when the user wants to know what opened
   up — closing this loop is the most useful thing you can do here.

### 5. Group tasks into epics

Trigger: "group these into epics", "this plan is too big", "reorganize the tasks",
"split up progress.md", "the task list is unmanageable".

Promotes a **flat** plan to **epic mode**. (There is no reverse operation; to
reorganize a plan that's already epic mode, move tasks one at a time via operation
3.) It renames every task and moves every file, so it is one deliberate, reviewed,
atomic change.

**Read `references/epics.md` and follow its migration checklist step by step — it
is authoritative and deliberately more detailed than this summary.** Do not
migrate from this summary alone; it omits the exact outputs and validation rules,
and a partial migration leaves the plan in a mixed layout that later operations
refuse to touch. What the checklist covers, in outline:

1. Preconditions: coherent flat mode, clean git tree.
2. Read everything and **record the starting state** — `HEAD`, `git status`, and
   the baseline list of progress-section titles.
3. **Group by structure**, from the design's architecture plus the dependency
   clusters. **Ignore any existing phase or stage headings**: they group by
   delivery, they cut across subsystems, and reusing them produces exactly the
   incoherent epics this operation exists to fix.
4. **Propose and get explicit approval** before writing anything — including the
   new id for every task, since some stems get renamed.
5. **Re-verify `HEAD` and `git status` after the approval pause**, immediately
   before the first write. Abort and re-propose if anything moved.
6. Move files, rewrite `TASKS.md` into its full epic-mode shape (including the
   generated epic rollup and the swapped progress-log blockquote), fix relative
   links, and split the progress log — each new file getting its header and an
   `Epic summary`, log entries moved verbatim, unattributable sections parked in
   `_unassigned.md` rather than dropped.
7. **Validate** — the data-loss check is **set equality** on section titles
   excluding the generated `Epic summary` sections, never a raw count.
8. **Report, stage with `git add -A`, and stop without committing.**

Don't run this on a plan that doesn't need it — if it's under the threshold in
`epics.md` on both counts, say so and leave it flat.

## Validate the graph

Whenever you read or write the dependency graph, check:
- **No cycles in the task graph** — A→B→A means neither can ever start; report it.
- **No dangling deps** — every referenced dependency names a task that exists, at
  the path its id implies.
- **Consistency** — the Mermaid diagram, the canonical list, and per-task
  Dependencies sections name the same edges. In epic mode, also check the epic
  rollup: every rollup edge is backed by at least one cross-epic task edge, and
  every cross-epic task edge appears in the rollup.

**A cycle in the epic rollup is not a defect.** Projecting an acyclic task graph
onto epics routinely produces one — `core/types --> ui/buttons` plus
`ui/theme --> core/palette` is acyclic at the task level and rolls up to
`core --> ui` and `ui --> core`. Only the **task** graph must be acyclic. Never add
or drop a task dependency to tidy the rollup: inventing false edges to smooth a
derived diagram destroys real parallelism.

A small project won't need tooling for this — reason over it directly. Only reach
for a script if a graph is large enough that manual tracing is error-prone.

## Principles

- **The files are the source of truth, not this conversation.** Always read the
  current `TASKS.md` before answering "what's next" or updating — it may have
  changed since you last saw it.
- **Keep edits surgical.** Touch only the lines that change; preserve the user's
  wording, ordering, and any epic structure.
- **Epics are structure, not schedule.** They group tasks that share code and
  concepts. The moment they start tracking delivery stages, they stop making the
  plan easier to read.
- **One canonical graph.** Task-level dependencies are authoritative; epic status
  and the epic rollup are derived from them. Never author a second graph.
- **Don't over-plan.** The plan is a tool for momentum, not a deliverable.
  Concise design, real dependencies, tasks sized to actually finish — and epics
  only when a flat list genuinely stopped working.
