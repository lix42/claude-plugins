# Epics — when to use them and how to group

Epics are the optional second level of the plan: `epic → task`. They exist for one
reason — past a dozen or so tasks, a flat list and a single execution log stop
being readable. Sharding by epic keeps every read small: you read your epic's
tasks and your epic's progress file, not the whole project's history.

This file covers **when** to introduce epics, **what** makes a good epic, and how to
**group** an existing flat plan into epics.

**This file is authoritative** for the epic threshold and for the grouping
procedure. `SKILL.md` and the commands summarize both; where any of them disagrees
with this file, this file wins — and the disagreement is a bug worth fixing.

## Two modes

A project is in exactly one of two modes, and the layout tells you which:

**Flat mode** — small plans. Task ids are bare kebab names.

```
docs/
  TASKS.md              (generated)
  tasks/_header.md
  tasks/<task>.md
  progress.md
```

**Epic mode** — large plans. Task ids are `<epic>/<task>`.

```
docs/
  TASKS.md              (generated)
  tasks/_header.md
  tasks/<epic>/_epic.md
  tasks/<epic>/<task>.md
  progress/<epic>.md
  progress/_unassigned.md    # only if grouping found log sections naming no task
```

The CLI detects the mode from `docs/tasks/`: task files mean flat, epic directories
mean epic, and both at once is a **mixed layout** it refuses to touch. A mixed
layout means an interrupted manual reorganisation; since `tasks group` writes
everything in one step, recover by restoring `docs/` from the last commit
(`git restore --source=HEAD --staged --worktree -- docs/`, then a scoped
`git clean -nd docs/` to see what's untracked before `-fd`) and re-running it. Never
run an unscoped `git clean`.

Both modes are fully supported. A flat project is not a broken project, and you
should not push grouping on one that doesn't need it.

## When to introduce epics

Introduce epics when **any** of these holds:

- the plan has **more than ~12 tasks**, or
- the work spans **3 or more separable subsystems** that different tasks touch
  **and has enough tasks to give each resulting epic about three** — a 6-task plan
  across 3 subsystems does not qualify, because 2-task epics violate the sizing
  rule below and folding them together would merge unrelated subsystems. When the
  seams are real but the tasks are few, stay flat and revisit as the plan grows, or
- **`progress.md` has outgrown a single comfortable read** — past a few hundred
  lines, so that starting any task means paging through the whole project's
  history. This is the symptom epics were built for, and it can arrive before the
  task count does.

One caveat on the third trigger: if the log is huge but the plan is genuinely
small and has no structural seams, sharding it into two epics won't help much. A
bloated log on a small plan usually means individual task sections have grown into
design essays, and the fix is to move that material into the task files where it
belongs (see `progress-md-format.md`). Check that first; reach for epics when the
log is long because the *project* is big, not because a few entries are.

Stay flat below all three. Epics on a 6-task plan add ceremony and buy nothing — one
directory per epic, one progress file per epic, and longer ids, all to organize a
list that already fits on a screen.

At setup time, make this call *before* proposing the task split, so the proposed
ids are right the first time. Mid-project, when a flat plan crosses the threshold,
offer the grouping below — offer it, don't perform it unasked.

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
  keep the fuller name. In `tasks group` it is a `{ "from", "name" }` entry.
- **Ids must be unique, and stripping can collide.** An epic holding both
  `parser.md` and `eval-parser.md` maps both to `eval/parser`. Check the full set
  of proposed ids for duplicates before proposing (`tasks group` refuses a
  collision too); keep the colliding task's fuller stem rather than inventing a
  suffix. Two tasks whose
  names collapse to the same name are also worth a second look — they may be
  duplicates, or badly named.

Mermaid accepts `/` in bare node ids, so `core/foundation --> color/p3-output`
needs no quoting or id-mapping layer. Do not invent `core_foundation`-style
aliases; they create a second naming scheme that drifts from the real ids.

## Grouping a flat plan into epics

This is the **Group tasks into epics** operation. It renames every task, so it is one
deliberate, reviewed change, made in one step by `tasks group`.

1. **Preconditions.** The plan is flat and in the frontmatter format (`tasks check`
   runs). `tasks group` refuses to run with uncommitted changes under `docs/`, so the
   result is reviewable as one diff.
2. **Read** the header's design, every task file, and the progress log's section
   headings — you need to know what each task actually touches, which titles alone
   don't tell you.
3. **Derive the grouping by structure**, per the rules above. Ignore any old phase
   or story headings: they group by delivery and cut across subsystems.
4. **Propose it and get explicit approval**: each epic with a one-line scope, the
   tasks under it, the **new id** for every task (the prefix rule renames some), and
   any placement that was a judgment call. Check the new ids are unique.
5. **Write the map** (any path; it isn't part of the plan):

   ```json
   {"epics": [
     {"name": "eval", "blurb": "Parsing, precedence, numeric representation.",
      "tasks": [{"from": "eval-parser", "name": "parser"}, "numeric-tower"]},
     {"name": "term", "tasks": [{"from": "tui-skeleton", "name": "skeleton"}]}
   ]}
   ```

   Epics appear in `TASKS.md` in this order. A plain string keeps the task's name;
   `{ "from", "name" }` renames it.
6. **Run `tasks group <map.json> --dry-run`**, then `tasks group <map.json>`. In one
   step it:
   - moves every task file to `tasks/<epic>/<name>.md` and rewrites every `deps`,
     `related` and `closed_into`;
   - re-bases every relative link in the moved files (inline, reference definitions
     and `href`) and repoints links to moved tasks in every other file under `docs/`;
   - writes each `_epic.md` (title, order, the blurb as scope);
   - splits `progress.md` into `progress/<epic>.md`: each file gets the epic header
     and an `## Epic summary` placeholder; each task's section moves **verbatim**
     under its (possibly renamed) heading, with only relative link targets
     re-based; sections naming no task go to `progress/_unassigned.md`; open tasks
     without a section get a stub; `progress.md` is deleted;
   - re-renders `TASKS.md`, and lists old task paths still mentioned **outside**
     `docs/` (READMEs, ADRs, code comments) — review those; it doesn't rewrite them.
7. **Finish by hand**: rewrite the progress-log note in `tasks/_header.md` for epic
   mode (point at `progress/`; read your epic's file plus the `Epic summary` of
   every epic you depend on); write each `Epic summary` from what the moved sections
   say (leave the placeholder rather than invent one); move anything in
   `_unassigned.md` that clearly belongs to an epic.
8. **Validate and report**: `tasks check`, and `git diff --stat` for the user. Don't
   commit — the user reviews one diff and commits it.

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

Once in epic mode, reorganising one task is an **update**: `tasks mv <old-id>
<new-id>`. It moves the file (creating the destination epic's `_epic.md` if new),
rewrites the id in every task's frontmatter, re-bases the moved file's relative
links and repoints links to it everywhere under `docs/`, moves its progress section
(heading renamed if the name changed, entries verbatim), and re-renders `TASKS.md`.
It lists backticked mentions of the old id elsewhere in the repository without
rewriting them — an id can also be an ordinary word. Review those, update both
epics' `Epic summary` if the move changes what another epic needs to know, and run
`tasks check`.
