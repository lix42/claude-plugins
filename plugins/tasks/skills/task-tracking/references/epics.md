# Epics — when to use them and how to group

Epics are the optional second level of the plan: `epic → task`. They exist for one
reason — past a dozen or so tasks, a flat list and a single execution log stop
being readable. Sharding by epic keeps every read small: you read your epic's
tasks and your epic's progress file, not the whole project's history.

This file covers **when** to introduce epics, **what** makes a good epic, and the
**migration** that converts an existing flat plan into an epic plan.

**This file is authoritative** for the epic threshold and for the migration
procedure. `SKILL.md` and the commands summarize both; where any of them disagrees
with this file, this file wins — and the disagreement is a bug worth fixing.

## Two modes

A project is in exactly one of two modes, and the layout tells you which:

**Flat mode** — small plans. Task ids are bare kebab names.

```
docs/
  TASKS.md
  tasks/<task>.md
  progress.md
```

**Epic mode** — large plans. Task ids are `<epic>/<task>`.

```
docs/
  TASKS.md
  tasks/<epic>/<task>.md
  progress/<epic>.md
  progress/_unassigned.md    # only if the migration found homeless log sections
```

**Detect the mode before doing anything else, and fail closed.** Don't test one
signal — check the whole layout, because a half-finished migration looks exactly
like an OR-heuristic's idea of epic mode, and treating it as epic mode means
writing to the wrong progress file and compounding the damage.

- **Coherent flat**: `docs/progress.md` exists, `docs/tasks/` holds only files (no
  subdirectories), no `docs/progress/` directory.
- **Coherent epic**: `docs/progress/` exists, `docs/tasks/` holds only
  subdirectories (no loose task files), no `docs/progress.md`.
- **Anything else is a mixed layout** — loose task files beside epic directories,
  both `progress.md` and `progress/`, an epic directory with no matching progress
  file. **Stop and report it. Do not guess a mode and do not keep writing.**

A mixed layout almost always means an interrupted migration. To recover: if
nothing has been committed, `git checkout` / `git clean` back to the pre-migration
state and re-run the migration from the top — it is designed to be restartable
from a clean flat plan, not resumable from the middle. If the partial state was
already committed, tell the user which artifacts exist on each side and let them
choose the direction before you touch anything.

Both modes are fully supported. A flat project is not a broken project, and you
should not push migration on one that doesn't need it.

## When to introduce epics

Introduce epics when **either** holds:

- the plan has **more than ~12 tasks**, or
- the work spans **3 or more separable subsystems** that different tasks touch.

Stay flat below that. Epics on a 6-task plan add ceremony and buy nothing — one
directory per epic, one progress file per epic, and longer ids, all to organize a
list that already fits on a screen.

At setup time, make this call *before* proposing the task split, so the proposed
ids are right the first time. Mid-project, when a flat plan crosses the threshold,
offer the migration below — offer it, don't perform it unasked.

## What makes an epic

**An epic is a cohesive area of the system** — a module, layer, or surface whose
tasks share files and concepts. Epics are about **structure**, not schedule.

How to derive them:

- **Start from the Design section's Architecture bullets.** In a well-written
  plan they are already the epic list, near enough. A design that names
  `io/decode`, `pipeline/color`, `algo`, and `cli` is telling you its epics.
- **Corroborate with the dependency graph.** Tasks that cluster — dense edges
  among themselves, few edges outward — usually belong to one epic.
- **Corroborate with the code.** Tasks that edit the same module or directory
  belong together; that is the whole point, because it is also what makes two
  tasks conflict when run in parallel.

**Never group by:**

- **Time or delivery stage** — "Phase 1", "MVP", "post-launch". This is the most
  tempting wrong answer and the most damaging: a delivery stage cuts across every
  subsystem, so its tasks share no files, no types, and no context. The resulting
  "epic" progress file is a grab bag, which is the problem epics were meant to fix.
- **Status or priority** — "done", "blocked", "nice to have". These change; epic
  membership shouldn't.
- **Who does the work.**

Sizing:

- **3–10 tasks per epic** is the healthy range.
- Fewer than 3 → fold it into the neighboring epic it most resembles.
- More than 10 → it is probably two structures wearing one name; look for the
  seam and split.
- Every task belongs to **exactly one** epic. For a cross-cutting task, the owning
  epic is the one that **owns the code the task changes**, not the one that
  motivated the work.

## Naming

- Epic ids are **kebab-case** and match the directory name: `docs/tasks/color/` ↔
  epic `color`, `docs/progress/color.md`.
- Task ids are **`<epic>/<task>`** and match the path stem:
  `docs/tasks/color/p3-output.md` ↔ `color/p3-output`.
- Prefer short structural nouns — `io`, `color`, `cli`, `render-output` — over
  narrative names. The epic is a place in the system, so it should read like one.
- **Strip a redundant epic prefix from the task stem.** When a flat name already
  carries its epic, the epic segment would otherwise be said twice: `eval-parser`
  under epic `eval` becomes `eval/parser`, not `eval/eval-parser`; `tui-skeleton`
  under epic `term` becomes `term/skeleton`. Strip only a genuinely redundant
  prefix — if removing it leaves a name that no longer says what the task is
  (`color/color-management` → `color/management` is fine, but `io/io.md` is not),
  keep the fuller name. **This is a rename**, so everything in "Moving a single
  task between epics" below applies to it.

Mermaid accepts `/` in bare node ids, so `core/foundation --> color/p3-output`
needs no quoting or id-mapping layer. Do not invent `core_foundation`-style
aliases; they create a second naming scheme that drifts from the real ids.

## Migrating a flat plan to epics

This is the **Group tasks into epics** operation. It renames every task and moves
every file, so it is one deliberate, reviewed, atomic change — not something to do
incrementally.

### Preconditions

- The project is in **coherent flat mode** (see the detection rules above).
  Already-epic projects have nothing to migrate; to reorganize those, move tasks
  between epics one at a time via the update operation. A *mixed* layout is not a
  migration candidate — it's an interrupted migration, so recover it first.
- The **git working tree is clean.** Say so and stop if it isn't — the migration
  moves dozens of files and must be reviewable as one diff.

### Steps

1. **Read everything, and record the starting state.** `TASKS.md` in full, every
   `docs/tasks/*.md`, and the section headings of `progress.md` — you need to know
   what each task actually touches, which you cannot get from titles alone. Also
   record, for the check in step 4:
   - the current `HEAD` sha,
   - the exact output of `git status --porcelain` (expected: empty),
   - **the complete list of `##` section titles in `progress.md`**, which is the
     baseline for the data-loss check in step 9.
2. **Derive the grouping by structure**, per the rules above. **Ignore any
   existing phase/stage headings in `TASKS.md`** — they group by delivery, and
   reusing them produces exactly the incoherent epics this operation exists to
   avoid. Read them for context if you like, then set them aside and group by
   subsystem.
3. **Propose it and get explicit approval.** Show the epic list with a one-line
   scope for each, the tasks under each, the **new id** for every task (the stem
   rule above renames some of them), and any placement that was a judgment call.
   Write nothing before the user signs off.
4. **Re-verify the state you recorded, immediately before the first write.**
   Approval is a pause of unknown length: the user, another agent, or an editor may
   have changed the plan while you waited. Re-read `HEAD` and `git status
   --porcelain` and compare them to step 1. **If either changed, abort, re-read the
   plan, and re-propose** — do not migrate from a stale reading, and never sweep
   someone else's edits into this commit.
5. **Move the task files** with `git mv` into `docs/tasks/<epic>/<task>.md`,
   applying the redundant-prefix rule above to each stem. Use `git mv`, not
   write-then-delete, so the diff shows renames and the history survives.
6. **Rewrite `TASKS.md` into its epic-mode shape.** Every element listed in
   `tasks-md-format.md` under "Structure (epic mode)" must be present when you're
   done — work that list, not just the ids:
   - **Progress-log blockquote** at the top — replace the flat one (which points at
     `progress.md`, the file step 8 deletes) with the epic-mode text pointing at
     `progress/` and the read-your-epic-plus-summaries protocol.
   - **Dependency list** — both sides of every entry, using the new ids.
   - **Task-level Mermaid diagram** — new node ids, wrapped in one `subgraph` per
     epic.
   - **Epic rollup diagram** — *generate it*, above the task-level one. Project
     each cross-epic task edge onto its epics and drop intra-epic edges and
     duplicates. It doesn't exist in a flat plan, so there is nothing to rewrite;
     if you skip it, the plan fails its own validation on the next query.
   - **Task list** — regrouped under `### <epic> — [progress](progress/<epic>.md)`
     headings, each with a `>` scope line, links now `tasks/<epic>/<task>.md`.
   - **Delete the phase headings.** Their delivery information is not preserved by
     this format. If the user wants it kept, offer to note it in the epic scope
     lines or in the task files — but do not leave phase headings in `TASKS.md`.
7. **Fix the per-task `Dependencies` links.** They're relative within
   `docs/tasks/`, so a same-epic dep is `other-task.md` and a cross-epic dep is
   `../other-epic/other-task.md`. Every task file needs checking, not just the
   moved-across-epics ones — the hop count changed for all of them.
8. **Split `progress.md`** into `docs/progress/<epic>.md`:
   - Give each file the **header** from `progress-md-format.md`:
     `# <Project> — <epic> Progress Log` plus the intro paragraph. A migrated epic
     file must be indistinguishable from one `/tasks-setup` would have written.
   - Add an **`## Epic summary`** below the header. Write it from what the moved
     sections actually say — the decisions and gotchas another epic would need. If
     you can't yet tell, leave the placeholder rather than inventing one. Never
     omit the section: the whole epic read protocol depends on it existing.
   - Move each task's section into its epic's file. **The `##` heading is rewritten
     to the bare task name** (the part after the `/`, per `progress-md-format.md`);
     **the body — every log entry — moves verbatim.** Never rewrite, summarize,
     reorder, or drop a log entry. This is a history.
   - **Homeless sections** — log sections that name no task (planning notes,
     review triage, cross-cutting write-ups) go to `docs/progress/_unassigned.md`
     verbatim, and you tell the user they're there. Do not force them into an
     epic and do not drop them.
   - Delete `docs/progress.md` once every section has a new home.
9. **Validate**, and report the result of each check:
   - **No history lost.** Take the baseline section-title list from step 1 and
     assert **set equality** against the union of every task section now in
     `docs/progress/*.md` plus every section in `_unassigned.md`, comparing on the
     task the section is *about* (its title changed when the stem did). Exclude
     `Epic summary` sections from both sides — they are newly generated, so a raw
     count will never match and is not the check. Set equality also catches a
     section filed under the wrong epic, which a count never would.
   - **Every epic file has exactly one `Epic summary`**, and every epic has a file.
   - Every id in the dependency list resolves to an existing
     `docs/tasks/<epic>/<task>.md`, and every task file appears in the list.
   - Every task file has a `##` section in its epic's progress file.
   - **The task graph has no cycles** and no dangling deps; the dependency list and
     the task-level diagram agree. (The *rollup* may contain cycles legitimately —
     see the note below. Don't flag those.)
   - Every rollup edge is backed by at least one cross-epic task edge, and every
     cross-epic task edge appears in the rollup.
   - The layout is **coherent epic mode** by the detection rules above: no phase
     headings, no `docs/progress.md`, no loose files left in `docs/tasks/`.
10. **Report** the epic list with task counts, every task whose id changed,
    anything parked in `_unassigned.md`, and the validation results. **Stage
    everything with `git add -A` and stop — do not commit.** The user reviews one
    staged diff and commits it themselves.

### The rollup may legitimately contain cycles

Projecting an acyclic task graph onto epics can produce a cycle, and that is not
an error: `core/types --> ui/buttons` and `ui/theme --> core/palette` are perfectly
acyclic at the task level but roll up to `core --> ui` and `ui --> core`. The
task-level graph is the one that must be acyclic. Never "fix" a rollup cycle by
adding or removing task dependencies — inventing false edges to tidy a derived
diagram destroys real parallelism. If a rollup cycle bothers the user, the honest
answer is that the two epics are genuinely interleaved, which is a grouping
observation, not a graph defect.

### Moving a single task between epics

Once in epic mode, reorganizing one task is an **update** operation, not a
migration. It is still a rename, so do all of it:

1. `git mv docs/tasks/<old-epic>/<task>.md docs/tasks/<new-epic>/<task>.md`.
2. Rewrite the id in the dependency list (its own entry *and* every entry that
   names it), the Mermaid diagram, and the task list.
3. Fix the relative links in that task's `Dependencies` section and in every task
   file that links to it — the number of `../` hops changes.
4. Move its `##` section from `progress/<old-epic>.md` to `progress/<new-epic>.md`:
   the log entries move verbatim, and the heading changes only if the stem did.
   Update both files' `Epic summary` if the move changes what another epic needs
   to know.
5. Re-validate the graph, and regenerate the epic rollup — a move can add or
   remove cross-epic edges.
