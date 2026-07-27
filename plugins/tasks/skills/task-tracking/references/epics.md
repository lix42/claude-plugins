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

- **Uninitialized**: no `docs/TASKS.md`, no progress log in either shape, and no
  task files. No plan exists yet, so there is no mode to detect — setup creates
  one. An empty `docs/tasks/` directory is still uninitialized.
- **Coherent flat**: `docs/TASKS.md` exists, `docs/progress.md` exists,
  `docs/tasks/` holds only files (no subdirectories), no `docs/progress/`.
- **Coherent epic**: `docs/TASKS.md` exists, `docs/progress/` exists, `docs/tasks/`
  holds only subdirectories (no loose task files), no `docs/progress.md`.
- **Any other combination of existing plan artifacts is a mixed layout** — loose
  task files beside epic directories, both `progress.md` and `progress/`, an epic
  directory with no matching progress file, **or task files and a log with no
  `TASKS.md` at all**. **Stop and report it. Do not guess a mode and do not keep
  writing.**

`TASKS.md` is required for either layout to count as coherent: it holds the
canonical dependency graph and the authoritative status. Task files and a log
without it aren't a plan in a readable state — they're a plan with its index
missing, and operating on them means updating status that nothing records and
answering "what's next" from a graph that doesn't exist.

A mixed layout almost always means an interrupted migration. To recover:

- If **nothing has been committed**, revert to the pre-migration state and re-run
  the migration from the top — it is designed to be restartable from a clean flat
  plan, not resumable from the middle. **Scope the cleanup to the plan**, and show
  the user a dry run first (`git status`, and `git clean -nd docs/`). Then:

  ```sh
  git restore --source=HEAD --staged --worktree -- docs/   # tracked files: index AND worktree
  git clean -fd docs/                                      # generated files: explicit pathspec
  ```

  Both details matter, and each has a failure mode that looks like success:

  - **`git checkout -- docs/` is not enough.** With no tree-ish it restores the
    worktree *from the index*, so a `git mv` that is already staged stays staged —
    the command exits 0, changes nothing, and leaves the tree exactly as broken as
    it found it. Verified on git 2.55. `git restore --source=HEAD --staged
    --worktree` resets both index and worktree from the last commit, which is what
    "back to pre-migration" actually means.
  - **Never run an unscoped `git clean -fd`.** The pathspec is optional and `-d`
    takes whole directories, so a bare invocation deletes every untracked file in
    the repository, including work created after the migration started that has
    nothing to do with it.
- If the partial state was **already committed**, tell the user which artifacts
  exist on each side and let them choose the direction before you touch anything.

Both modes are fully supported. A flat project is not a broken project, and you
should not push migration on one that doesn't need it.

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
- **Ids must be unique, and stripping can collide.** An epic holding both
  `parser.md` and `eval-parser.md` maps both to `eval/parser`. Check the full set
  of proposed ids for duplicates *before* the first write; on a collision, keep the
  colliding task's fuller stem rather than inventing a suffix. Two tasks whose
  names collapse to the same name are also worth a second look — they may be
  duplicates, or badly named.

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
   - **the complete list of `##` section titles in `progress.md`, plus a
     content fingerprint of each section's body** — a hash of the body text, or the
     exact body itself. **Not a line count:** content can be deleted, reordered, or
     rewritten without changing how many lines it occupies, which defeats the guard
     in precisely the case it exists to catch. Both are the baseline for the
     data-loss checks in step 9; titles alone can't prove the entries survived.
2. **Derive the grouping by structure**, per the rules above. **Ignore any
   existing phase/stage headings in `TASKS.md`** — they group by delivery, and
   reusing them produces exactly the incoherent epics this operation exists to
   avoid. Read them for context if you like, then set them aside and group by
   subsystem.
3. **Propose it and get explicit approval.** Show the epic list with a one-line
   scope for each, the tasks under each, the **new id** for every task (the stem
   rule above renames some of them), and any placement that was a judgment call.
   Before proposing, **check the proposed ids are unique** — the prefix-stripping
   rule can collapse two names onto one, and discovering that mid-`git mv` leaves
   a half-moved tree. Write nothing before the user signs off.
4. **Re-verify the state you recorded, immediately before the first write.**
   Approval is a pause of unknown length: the user, another agent, or an editor may
   have changed the plan while you waited. Re-read `HEAD` and `git status
   --porcelain` and compare them to step 1. **If either changed, abort, re-read the
   plan, and re-propose** — do not migrate from a stale reading, and never sweep
   someone else's edits into this commit.
5. **Create the epic directories, then move the task files.** `mkdir -p
   docs/tasks/<epic>` for every approved epic *first* — a coherent flat layout has
   no epic subdirectories, and `git mv` into a missing parent fails with
   `fatal: renaming ... failed: No such file or directory` (exit 128), aborting on
   the very first task. Then `git mv` each file to `docs/tasks/<epic>/<task>.md`,
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
   - **Epic rollup diagram** — *generate it*, above the task-level one. **Emit a
     bare node line for every epic first**, then project each cross-epic task edge
     onto its epics, dropping intra-epic edges and duplicates. Declaring the nodes
     up front matters: an epic with no cross-epic dependencies has no edges to
     project, so an edges-only rollup would silently omit a whole subsystem that
     the task list clearly contains. It doesn't exist in a flat plan, so there is
     nothing to rewrite; if you skip it, the plan fails its own validation on the
     next query.
   - **Task list** — regrouped under `### <epic> — [progress](progress/<epic>.md)`
     headings, each with a `>` scope line, links now `tasks/<epic>/<task>.md`.
   - **Delete the phase headings.** Their delivery information is not preserved by
     this format. If the user wants it kept, offer to note it in the epic scope
     lines or in the task files — but do not leave phase headings in `TASKS.md`.
7. **Fix the relative links in every moved task file — all of them, not just the
   `Dependencies` section.** Each file moved one directory deeper, so *every*
   relative path in it is now off by one level:
   - `Dependencies` links are relative within `docs/tasks/`: a same-epic dep is
     `other-task.md`, a cross-epic dep is `../other-epic/other-task.md`.
   - **Links anywhere else in the body** — Design, How to Verify, prose — need the
     same correction. A user-authored `../design.md` used to resolve to
     `docs/design.md` and now points at the nonexistent `docs/tasks/design.md`;
     it needs a third level (`../../design.md`). Links to repository source files
     shift by one level too.
   - Absolute paths, URLs, and in-page anchors are unaffected — leave them alone.

   **Scan for every link form, not just `](`.** Inline links are the common case,
   but a hand-edited task file may also carry reference definitions
   (`[spec]: ../design.md` on its own line, used as `[design][spec]`) and raw HTML
   (`<a href="...">`). A `](`-only scan silently misses both. Every task file needs
   this, not just the ones whose epic assignment felt like a change.
8. **Split `progress.md`** into `docs/progress/<epic>.md`. **`mkdir -p
   docs/progress` first** — a coherent flat layout has no such directory, and a
   shell redirect or a writer that won't create parents fails on the first file,
   stranding the tree in the mixed state everything downstream refuses to touch.
   Then, for each epic:
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
   - **The one permitted body edit: relative link targets.** The sections move from
     `docs/progress.md` down into `docs/progress/<epic>.md`, so a link like
     `tasks/parser.md` would start resolving under `docs/progress/tasks/`. Retarget
     such links for the extra level (`../tasks/<epic>/parser.md`), and account for
     any task stem you renamed. Change only what's inside the `(...)` — the visible
     link text and every other word stay exactly as written. Fixing a pointer so it
     still resolves preserves the history; letting it rot silently does not.
   - **Homeless sections** — log sections that name no task (planning notes,
     review triage, cross-cutting write-ups) go to `docs/progress/_unassigned.md`
     verbatim, and you tell the user they're there. Do not force them into an
     epic and do not drop them.
   - Delete `docs/progress.md` once every section has a new home.
9. **Validate**, and report the result of each check:
   - **No section lost.** Take the baseline section-title list from step 1 and
     assert **set equality** against the union of every task section now in
     `docs/progress/*.md` plus every section in `_unassigned.md`, comparing on the
     task the section is *about* (its title changed when the stem did). Exclude
     `Epic summary` sections from both sides — they are newly generated, so a raw
     count will never match and is not the check. Set equality also catches a
     section filed under the wrong epic, which a count never would.
   - **No history lost *inside* a section.** Matching titles prove nothing about
     the entries beneath them: a migration that keeps every heading and truncates
     the logs passes the check above. Compare each section's **body** against the
     original — line count and content, or a per-section fingerprint taken before
     the split. The only differences allowed are the heading rename and the
     retargeted relative links from step 8; anything else means content was lost.
     This is the check that actually enforces "verbatim".
   - **Every relative link resolves.** Check the moved task files and the split
     progress files — both changed depth, and both were edited by hand. Check every
     link form, not just `](`.
   - **No inbound link left dangling.** Every task moved, so anything *outside* the
     plan that pointed at an old path — `docs/architecture.md` linking to
     `tasks/parser.md`, a README, an ADR — is now broken. Search the repository for
     references to the old task paths, fix the ones that are clearly plan
     references, and **list anything you didn't change in the report** rather than
     editing unrelated documents silently.
   - **Every epic file has exactly one `Epic summary`**, and every epic has a file.
   - Every id in the dependency list resolves to an existing
     `docs/tasks/<epic>/<task>.md`, and every task file appears in the list.
   - Every task file has a `##` section in its epic's progress file.
   - **The task graph has no cycles** and no dangling deps; the dependency list and
     the task-level diagram agree. (The *rollup* may contain cycles legitimately —
     see the note below. Don't flag those.)
   - Every rollup edge is backed by at least one cross-epic task edge, and every
     cross-epic task edge appears in the rollup. **Every epic appears in the rollup
     as a node**, including ones with no cross-epic edges at all.
   - The layout is **coherent epic mode** by the detection rules above: no phase
     headings, no `docs/progress.md`, no loose files left in `docs/tasks/`.
10. **Report** the epic list with task counts, every task whose id changed,
    anything parked in `_unassigned.md`, and the validation results. Then **stage
    the migration's own paths and stop — do not commit.** The user reviews one
    staged diff and commits it themselves.

    **Stage explicitly, not with `git add -A`.** The migration takes a while, and
    `-A` stages every tracked and untracked change in the repository — so anything
    a user, editor, or parallel agent touched while it ran gets swept into their
    commit. Compare the worktree against the set of paths this migration was
    supposed to change, stage exactly those, and if anything unexpected appeared,
    leave it unstaged and say so in the report. Step 4 guards the window before the
    first write; this guards the window after the last one.

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

1. `git mv docs/tasks/<old-epic>/<task>.md docs/tasks/<new-epic>/<task>.md`. If the
   destination epic is **new**, `mkdir -p` its task directory and create its
   progress file with a header and `Epic summary` first — `git mv` into a missing
   parent fails, and an epic directory with no progress file is a mixed layout.
2. Rewrite the id in the dependency list (its own entry *and* every entry that
   names it), the Mermaid diagram, and the task list.
3. Fix the relative links **everywhere in the moved file, not just its
   `Dependencies` section**, and in every task file that links to it — the number
   of `../` hops changes in both directions. A link from the moved file's Design or
   How-to-Verify prose to a task that used to be a same-epic neighbour
   (`history.md`) is now cross-epic (`../app/history.md`), and graph validation
   won't catch it because it never looked outside `Dependencies`. Check every link
   form — inline, reference definitions, and raw HTML — not just `](`.
4. Move its `##` section from `progress/<old-epic>.md` to `progress/<new-epic>.md`:
   the log entries move verbatim, and the heading changes only if the stem did.
   Update both files' `Epic summary` if the move changes what another epic needs
   to know.
5. **Retarget progress-log links that point at the moved task.** Its path changed,
   so an entry anywhere in `docs/progress/` reading `../tasks/app/state.md` now
   points at nothing. Search every progress file — including the section you just
   moved — and fix the destinations, leaving the surrounding log text untouched.
   The same "retargeting a pointer is the one permitted body edit" rule from the
   full migration applies here.
6. Search the repository for inbound links to the task's **old** path, the same as
   the migration does — other documents don't get updated by the graph validation.
7. Re-validate the graph, and regenerate the epic rollup — a move can add or
   remove cross-epic edges.
