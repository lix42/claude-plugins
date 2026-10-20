---
name: task-tracking
description: >-
  Plan and track development work as docs/tasks/ files with frontmatter (status,
  deps) connected by a dependency graph, optionally grouped into epics, queried and
  updated with a bundled `tasks` CLI that also generates docs/TASKS.md. Use this
  whenever the user wants to break a feature or project into tasks, set up or write
  a plan/roadmap, asks "what should I work on next", "what's unblocked", "what can
  run in parallel", asks about the plan or remaining work, wants to add/remove/
  change/split tasks, wants to group tasks into epics or reorganize a plan that has
  grown too big, says they finished/completed a task or piece of work, or wants to
  log progress. Also use it when a docs/TASKS.md already exists and the user is
  discussing progress or next steps.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Task Tracking

A file-based plan: one markdown file per task, whose **frontmatter** holds its status
and dependencies, plus a progress log of how the work went. Everything lives under
`docs/`, so it is diffable and reviewable; a small CLI does the bookkeeping so no fact
is kept in two places by hand.

## The CLI

`tasks` below means `node <this-skill-directory>/cli/tasks.ts <command>`.
Use the absolute base directory supplied when this skill loads, not the project's
working directory. In Claude Code the equivalent is:

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/cli/tasks.ts <command>
```

(In OpenCode, Codex, or wherever `${CLAUDE_PLUGIN_ROOT}` isn't set: `cli/tasks.ts` in this
skill's directory.) It needs Node 22.18+ and nothing installed. It finds `docs/` by
walking up to the git root; pass `--root <docs-dir>` otherwise. Add `--json` to any
command for machine-readable output. `tasks help` lists everything.

| Need | Command |
|---|---|
| What can start now, ranked | `tasks ready [--epic E]` |
| One task: fields, deps with status, dependents, file and log paths | `tasks show <id>` |
| Filter | `tasks list [--epic E] [--status todo,doing] [--tag T] [--open]` |
| Why is it blocked / what does it open up | `tasks deps <id> [--all]`, `tasks unblocks <id>` |
| Change status, deps, fields | `tasks set <id> status=doing deps+=a,b priority=low` |
| Add a task | `tasks new <id> --title T [--deps a,b] [--summary S]` |
| Rename / move between epics | `tasks mv <old> <new>` |
| Log progress | `tasks log <id> "what happened"` (multi-line: pipe it with `-`) |
| Validate | `tasks check [--strict]` |
| Regenerate the index | `tasks render` |

Ids are `<name>` in a flat plan and `<epic>/<name>` with epics; any command accepts a
unique name or substring. Every update re-renders `docs/TASKS.md` itself.

**Never hand-edit `docs/TASKS.md`** — it is generated, and `tasks check` fails when it
drifts. Edit a task's frontmatter with `tasks set` (or by hand, then `tasks render`).

## The model

```
Flat mode                          Epic mode
docs/                              docs/
  TASKS.md        (generated)        TASKS.md           (generated)
  tasks/                             tasks/
    _header.md    (top of TASKS.md)    _header.md
    <task>.md                          <epic>/_epic.md   (title, order, scope)
  progress.md                          <epic>/<task>.md
                                     progress/<epic>.md
```

- **A task file** is the task's spec, headed by its frontmatter — the single source
  of truth for status (`todo | doing | done | closed`) and hard dependencies.
  `references/task-file-format.md` has the fields.
- **`TASKS.md`** is a generated index: the hand-written `_header.md` (project
  intro, design summary, progress-log note), a dependency diagram (the epic rollup in
  epic mode), and every task with its status and what it waits on.
  `references/tasks-md-format.md` describes it.
- **The progress log** is the story of the work: one `##` section per task, dated
  entries, append-only. `references/progress-md-format.md` has the format.

A task is **ready** when it is `todo` and every dep is `done` or `closed`. `related`
links are shown but never gate. `priority: blocked` holds a task out of `ready`;
`priority: low` ranks it last.

A plan without frontmatter (status as `[x]` boxes in `TASKS.md`) is the old format:
every command but `migrate` refuses it. Offer operation 6.

## Operations

On Claude Code the `/tasks:*` commands route here; natural-language requests work on
any host.

### 1. Set up the tasks (plan a project)

Trigger: "plan this", "break this into tasks", "let's design X and split the work".

A **conversation, not a one-shot generation** — a plan the user didn't help shape is
one they won't trust:

1. **Understand the input.** It may be inline text, a path to a plan/design doc, or
   both (a path may be wrapped in prose: `read docs/plan.md and make tasks`). If a
   path-like token resolves to a file, read it as the primary input.
2. **Interview** on what's genuinely unclear: scope and non-goals, platform and
   stack, hard constraints, how "done" is judged. A few sharp questions, not a form;
   lighter when the user handed you a worked-out plan.
3. **Discuss the design.** Propose a concise high-level design; push back where
   something seems off; converge.
4. **Decide flat or epic before proposing the split** — the mode decides the ids.
   `references/epics.md` is authoritative on the threshold (more than ~12 tasks, or
   3+ separable subsystems with enough tasks for each). Epics are parts of the
   system, never delivery stages.
5. **Propose the split**: each task with a one-line purpose and its dependency
   edges, shown as a Mermaid graph. Tasks should be independently implementable and
   verifiable (about one focused PR); dependencies must be **real** — B needs a
   type, API or behaviour A produces. False edges kill parallelism.
6. **Get explicit approval.** Write nothing before it.
7. **Create**: `tasks init [--epics] --title "<Project>"`, edit
   `docs/tasks/_header.md` to carry the concise design (or a summary plus a link to
   the user's design doc — distill it, never move or overwrite it), then
   `tasks new` each task in dependency order (`--deps` must name existing tasks),
   and fill each file's Goal, Design and How to Verify. In epic mode, give each
   `tasks/<epic>/_epic.md` its scope line and order. Finish with `tasks check`.
8. **Confirm** what you created and run `tasks ready`.

### 2. What's next

Trigger: "what should I work on next", "what's unblocked", "what can run in
parallel", "show me the plan status".

1. Run `tasks ready` (scoped with `--epic` when the user names one — then report
   only that epic, plus at most one line on how many are ready elsewhere).
2. The CLI ranks by leverage: open work waiting downstream, then the longest chain
   hanging off the task (the critical path). Add what it can't know: break near-ties
   toward an epic already in progress, and **flag ready tasks that will fight over
   the same files** — read their task files to tell. Tasks in different epics are
   the safer parallel bets.
3. If nothing is ready, say what's in progress and, for the most valuable blocked
   tasks, exactly what they wait on (`tasks deps <id>`).
4. If `tasks check` reports errors (a cycle, a dangling dep), surface them first —
   the ready list can't be trusted until they're fixed.

When the user picks a task, read the progress log first: in flat mode all of
`docs/progress.md`; in epic mode the task's whole `docs/progress/<epic>.md`, plus
the `## Epic summary` of every epic it depends on.

### 3. Update the tasks

Trigger: "add a task for X", "we don't need Y", "split Z", "move W into `color`",
"this task changed".

- **Add**: `tasks new` (it also adds a stub section to the right progress log), then
  write the file's body. Wire in anything that should now depend on it with
  `tasks set <other> deps+=<new>`.
- **Remove**: prefer `tasks set <id> status=closed` (with `closed_into=<id>` when
  another task absorbed it) — the file stays as decision history. If a task file
  must really go, delete it and repair every dependent (`tasks unblocks <id>` lists
  them); `tasks check` reports any dangling reference left behind.
- **Change / split / merge**: edit the task files; adjust edges with
  `tasks set … deps+=… deps-=…`. When splitting, decide how dependents and
  dependencies distribute across the new tasks.
- **Rename or move between epics**: `tasks mv <old> <new>`. It moves the file
  (creating the epic if new), rewrites the id in every task's frontmatter, fixes
  relative links in all docs, moves the progress section, and lists backticked
  mentions of the old id elsewhere in the repo for you to review — it never
  rewrites prose ids itself, since an id can also be an ordinary word.

Then `tasks check`, and confirm what changed. If a flat plan has crossed the epic
threshold, offer operation 5 — don't do it as a side effect.

### 4. Mark a task started or done

Trigger: "I finished X", "X is done", "starting Y".

1. `tasks set <id> status=done done="<date> #<PR>"` (or `status=doing` when
   starting). It updates the frontmatter, the log's `Status` mirror and `TASKS.md`,
   and prints what just became ready.
2. **Close out the progress section** with a final entry
   (`tasks log <id> "…"`): the approach that landed, what's verified, and any note a
   dependent task needs.
3. **Update the `Epic summary`** (epic mode) by hand if the task changed what another
   epic needs to know — a new or changed interface, a constraining decision, a known
   gap. It is the one part of the log that is rewritten, and a stale one misleads.
4. Report what opened up.

### 5. Group a flat plan into epics

Trigger: "group these into epics", "this plan is too big", "split up progress.md".

`references/epics.md` is authoritative — the threshold, what makes a good epic, and
the procedure. In short: derive the grouping from the design's structure (never
from phase headings), propose every task's new id and get approval, then write the
mapping and run `tasks group <map.json>`. It needs a clean tree under `docs/`,
moves everything in one step, splits `progress.md` verbatim (sections naming no task
go to `progress/_unassigned.md`), and reports old paths still mentioned outside
`docs/`. Then fill in each `Epic summary` and the header's progress-log note, run
`tasks check`, and leave the diff for the user to review.

### 6. Migrate an old-format plan

Trigger: a `TASKS.md` with `[ ]`/`[x]` checkboxes and task files without
frontmatter; the CLI refusing with "predates frontmatter".

1. Make sure the git tree is clean, so the migration is one reviewable diff. Run
   `tasks migrate --dry-run` and show the user the report: counts by status, where
   each task's deps came from (the `TASKS.md` dependency list, "Depends …" prose in
   the list, or the task file's `## Dependencies` links), stub files to create,
   files the list never mentioned (migrated as `closed`), and every disagreement.
2. On approval, `tasks migrate`, then `tasks check`.
3. Review with the user: `tasks/_header.md` (the old preamble — trim what's stale),
   the unlisted files, and each disagreement. Text the migration couldn't fit a
   field is kept in the task body as a `**From TASKS.md**` note; tidy those as you
   touch the tasks, no need to sweep.

## Validate the graph

`tasks check` is the validation: no cycles, no dangling `deps`/`related`/
`closed_into`, valid frontmatter, a current `TASKS.md`; warnings for an open task
depending on a closed one, an open task's `## Dependencies` prose disagreeing with
its frontmatter, and an open task with no progress section. Run it after any
change; CI can run it too.

**A cycle in the epic rollup is not a defect.** An acyclic task graph can project to
a cyclic rollup (`core/types → ui/buttons` with `ui/theme → core/palette`). Only the
task graph must be acyclic — never add or drop a task edge to tidy the rollup.

## Principles

- **The files are the source of truth, not this conversation.** Query the CLI before
  answering; the plan may have changed since you last looked.
- **One fact, one place.** Status and edges live in frontmatter; `TASKS.md` and the
  rollup are derived. A `## Dependencies` section in a task file is optional prose
  about *why* — `tasks set` keeps its links in step when it exists.
- **Keep edits surgical.** Touch only what changes; preserve the user's wording.
- **Epics are structure, not schedule.**
- **Don't over-plan.** Concise design, real dependencies, tasks sized to finish.
