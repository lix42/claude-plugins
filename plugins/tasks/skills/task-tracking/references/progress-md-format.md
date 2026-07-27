# Progress log format

The progress log is a running record of **how the work is actually being carried
out** — what was done and *how*, the decisions made and why, what works, what
doesn't, and anything a later task needs to know. It is the narrative beside the
plan.

It complements the other two files rather than duplicating them:

- `TASKS.md` — the plan and the **authoritative status** (the `[ ]`/`[~]`/`[x]`
  checkboxes).
- `tasks/**/<name>.md` — the **spec** for a task (goal, intended design, how to
  verify).
- the progress log — the **execution log**: what happened when the task was built.

## Where it lives

The layout follows the project's mode (see `epics.md`):

- **Flat mode** — one `docs/progress.md`, one `##` section per task.
- **Epic mode** — one file per epic at `docs/progress/<epic>.md`, each with an
  `## Epic summary` followed by one `##` section per task. Plus, only if a
  migration produced them, `docs/progress/_unassigned.md`.

Per-epic files exist because a single log stops working at scale: a mature
project's log runs to thousands of lines, and every agent starting any task pays
to read all of it. Sharding by epic keeps each read to the part that's actually
relevant, and keeps parallel epics out of each other's diffs.

## What to read before starting a task

**Flat mode:** read `docs/progress.md` — all of it. A flat plan is under the epic
threshold precisely because the whole log still fits in one read; that is the
property epic mode exists to restore once it stops being true.

**Epic mode:** read

1. your task's **own epic file**, in full — the neighbouring tasks are the ones
   whose decisions and gotchas will bite you; and
2. the **`Epic summary`** section of every epic you depend on.

Read a dependency's full epic file only when the summary points at something you
need in detail. That's the whole trade: the summary is what makes it safe not to
read everything, so it has to be honest — see below.

## Structure (flat mode)

```markdown
# <Project> — Progress Log

How each task is actually being carried out — what was done and how, key
decisions, what works, what doesn't, and notes for dependent tasks. TASKS.md holds
the authoritative status (the checkboxes); this file is the narrative beside it.

One `##` section per task, named by the kebab task name (matching TASKS.md and the
task file). Read this file before starting a task; update your own section as you
work. Append log entries — don't rewrite earlier ones.

## <task-name>

**Status:** not started | in progress | done   <!-- mirrors TASKS.md; TASKS.md wins -->
**Updated:** <YYYY-MM-DD>

- <YYYY-MM-DD>: <what you did and how; a decision and why; what works / what
  doesn't; a note for a dependent task>
- <YYYY-MM-DD>: <next entry>
```

## Structure (epic mode)

One file per epic. The task sections are identical to flat mode — only the file
they live in and the summary above them are new.

```markdown
# <Project> — <epic> Progress Log

Execution log for the `<epic>` epic: what was done and how, key decisions, what
works, what doesn't. TASKS.md holds the authoritative status; this file is the
narrative beside it.

One `##` section per task in this epic, named by the bare task name (the part
after the `/`). Read this whole file before starting a task in this epic, and read
other epics' `Epic summary` sections when you depend on them. Append entries —
don't rewrite earlier ones.

## Epic summary

<What someone in **another** epic needs to know about this one: the interfaces it
exposes, the decisions that constrain them, known gaps, and anything that would
surprise a caller. A short paragraph or a handful of bullets — not a recap of
every task. Curated, so unlike the log entries below this section *is* rewritten
as understanding changes.>

## <task-name>

**Status:** not started | in progress | done   <!-- mirrors TASKS.md; TASKS.md wins -->
**Updated:** <YYYY-MM-DD>

- <YYYY-MM-DD>: <what you did and how; a decision and why; what works / what
  doesn't; a note for a dependent task>
```

Field rules:

- **Heading** is the task name: the full kebab name in flat mode, the bare task
  name (the part after the `/`) in epic mode — the epic is already the file. So
  task `color/p3-output` is `## p3-output` inside `progress/color.md`. That key is
  what makes the plan, spec, and log cross-referenceable. It follows that when a
  task's id changes — a migration, a move between epics — **the heading is
  rewritten to match while the log entries below it move untouched.** "Move it
  verbatim" always refers to the entries, never the heading.
- **`Status`** is a convenience mirror of the TASKS.md checkbox so a reader
  scanning the log sees state without cross-checking. If the two ever disagree,
  **TASKS.md wins** — fix the mirror.
- **`Updated`** is the date of the latest entry.
- **Log entries** are dated, newest last, and append-only. Favor the *how* and the
  *why* over the *what* (the what is already in TASKS.md / the task file): the
  approach taken, decisions and trade-offs, dead ends, what's verified working,
  known gaps.
- **`Epic summary`** (epic mode) is the one part that is *not* append-only. Keep
  it current: when a task lands something another epic depends on, or invalidates
  something the summary claims, update it in the same edit. A stale summary is
  worse than none, because it is read *instead of* the detail.

## Conventions

- **Stay in your own section.** Edit only the section for the task you're working
  on — plus your epic's summary when your work changes what others need to know.
  This is what keeps parallel work merge-clean.
- **Append, don't rewrite.** Add a new dated entry rather than editing old ones,
  so the log stays an honest history. (The `Epic summary` is the sole exception.)
- **Flag conflicts.** If your work contradicts a decision logged by another task,
  or you find two tasks fighting over the same module, note it in your section and
  raise it with the user — don't silently diverge. When the conflict crosses
  epics, say so in both epics' summaries.
- **Keep entries tight.** A few sentences per entry. This is a log, not a design
  doc; if a real design write-up is needed, it belongs in the task file or
  `docs/design.md`. Sharding by epic buys headroom, not license — a task section
  that has grown into an essay is a task file waiting to be written.
- **`_unassigned.md`** holds log sections a migration couldn't attribute to any
  task (planning notes, review triage, cross-cutting write-ups). It is a parking
  lot, not a category: when its content clearly belongs to an epic, move it there.

## Worked example (flat mode)

```markdown
# Calc — Progress Log

How each task is actually being carried out — what was done and how, key
decisions, what works, what doesn't, and notes for dependent tasks. TASKS.md holds
the authoritative status; this file is the narrative beside it.

One `##` section per task, named by the kebab task name. Read this before starting
a task; update your own section as you work. Append entries — don't rewrite them.

## eval-parser
**Status:** done
**Updated:** 2026-06-13

- 2026-06-13: Implemented recursive-descent parser as planned. Decided to return
  `Result<f64, String>` (not a custom error enum) — the UI only ever shows the
  message, so a string is enough and keeps the API tiny. Division by zero →
  `Err("Division by zero")`. All planned test cases pass.
- 2026-06-13: Note for `app-state`: the public entry point is `eval(&str)`, not a
  `Parser` you construct — `Parser` is private. Build state on top of `eval`.

## app-state
**Status:** in progress
**Updated:** 2026-06-13

- 2026-06-13: Wiring the state machine onto `eval`. Open question: how to represent
  an in-progress expression vs. a committed result — leaning toward a single
  `expr: String` + `last_result: Option<f64>` rather than an enum. Not verified yet.

## ui-buttons
**Status:** not started
**Updated:** —

- Goal: render the button grid with focus highlighting.
```

## Worked example (epic mode)

`docs/progress/eval.md`:

```markdown
# Calc — eval Progress Log

Execution log for the `eval` epic. TASKS.md holds the authoritative status; this
file is the narrative beside it.

One `##` section per task in this epic, named by the bare task name. Read this
whole file before starting an `eval` task; read other epics' `Epic summary` when
you depend on them. Append entries — don't rewrite them.

## Epic summary

- Public entry point is `eval(&str) -> Result<Value, EvalError>`. `Parser` is
  private — build on `eval`, not on the parser.
- `Value` is an enum, not `f64`: the numeric-tower work needs exact integers, and
  callers must match rather than assume a float. This changed after `app/state`
  was first written — see the 2026-06-20 entry.
- Division by zero is an `Err`, not an infinity. The UI renders the message.
- Known gap: no variables or function calls; the grammar has no room reserved for
  them, so adding either is a parser change, not an extension.

## parser
**Status:** done
**Updated:** 2026-06-20

- 2026-06-13: Implemented recursive-descent parser as planned. Returned
  `Result<f64, String>` initially — the UI only shows the message, so a string
  seemed enough.
- 2026-06-20: Reworked to `Result<Value, EvalError>` for `numeric-tower`. Note for
  `app`: this is a breaking change to the signature `app/state` calls; the string
  message is now `EvalError::to_string()`. Updated the epic summary.

## numeric-tower
**Status:** in progress
**Updated:** 2026-06-21

- 2026-06-21: Adding exact-integer `Value::Int` alongside `Value::Float`, promoting
  to float on division or overflow. Not verified yet; precedence tests pass but
  the promotion boundary has no coverage.
```
