# progress.md format

`docs/progress.md` is a running **log of how the work is actually being carried
out** — what was done and *how*, the decisions made and why, what works, what
doesn't, and anything a later task needs to know. It is the narrative beside the
plan.

It complements the other two files rather than duplicating them:

- `TASKS.md` — the plan and the **authoritative status** (the `[ ]`/`[~]`/`[x]`
  checkboxes).
- `tasks/<name>.md` — the **spec** for a task (goal, intended design, how to verify).
- `progress.md` — the **execution log**: what happened when the task was built.

Read it before starting a task to understand what's done, what worked, what
didn't, the decisions already made, and whether your task conflicts with one
already in flight.

## Why one file

All progress lives in this single file, one `##` section per task. That is
deliberate:

- **Easy to read in one shot** — an agent picking up a new task reads one file and
  sees the whole project's history and decisions.
- **Merge-friendly** — each task touches only its own section and appends entries
  (never rewrites earlier ones), so parallel branches rarely collide; when they
  do, the conflict is contained to one section.

## Structure

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

Field rules:

- **Heading** is the kebab task name, identical to the one in `TASKS.md`'s
  dependency list and the `tasks/<name>.md` stem. That key is what makes the three
  files cross-referenceable.
- **`Status`** is a convenience mirror of the TASKS.md checkbox so a reader scanning
  `progress.md` sees state without cross-checking. If the two ever disagree,
  **TASKS.md wins** — fix the mirror.
- **`Updated`** is the date of the latest entry.
- **Log entries** are dated, newest last, and append-only. Favor the *how* and the
  *why* over the *what* (the what is already in TASKS.md / the task file): the
  approach taken, decisions and trade-offs, dead ends, what's verified working,
  known gaps.

## Conventions

- **Stay in your own section.** Edit only the section for the task you're working.
  This is what keeps parallel work merge-clean.
- **Append, don't rewrite.** Add a new dated entry rather than editing old ones, so
  the log stays an honest history.
- **Flag conflicts.** If your work contradicts a decision logged by another task,
  or you find two tasks fighting over the same module, note it in your section and
  raise it with the user — don't silently diverge.
- **Keep entries tight.** A few sentences per entry. This is a log, not a design
  doc; if a real design write-up is needed, it belongs in the task file or
  `docs/design.md`.

## Worked example

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
