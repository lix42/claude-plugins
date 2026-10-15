# Per-task file format

Each task is one file, and its path is its id:

- **Flat mode** — `docs/tasks/<name>.md`, id `<name>`.
- **Epic mode** — `docs/tasks/<epic>/<name>.md`, id `<epic>/<name>`.

Both parts are kebab-case. Files starting with `_` (`_header.md`, `_epic.md`) are not
tasks.

The file opens with **frontmatter** — the task's state, read and written by the
`tasks` CLI — followed by the task's **spec**: enough that someone can implement it
without re-asking what it's for, while leaving the implementation to the
implementer.

## Frontmatter

```markdown
---
title: Expression parser and evaluator
status: todo
deps: [tui-skeleton]
related: [app-state]
priority: low
tags: [post-mvp]
summary: evaluate "2+3*4" to 14; the pure core with no UI
done: 2026-06-13 #12
closed_into: app-state
---
```

| Key | Required | Meaning |
|---|---|---|
| `title` | yes | Human title; the index links it. |
| `status` | yes | `todo`, `doing`, `done`, or `closed` (won't be done: superseded, folded into another task, or moot — kept as decision history). |
| `deps` | yes (may be `[]`) | Hard dependencies, by id. The task is ready only once each is `done` or `closed`. |
| `related` | no | Soft links: shown, never gate readiness. |
| `priority` | no | `low` (ranked last by `tasks ready`) or `blocked` (held out of it, e.g. waiting on a decision or an outside party). Absent means normal. |
| `tags` | no | Free labels for `tasks list --tag`. |
| `summary` | no | One line for the index. Not a status narrative — that goes in the progress log. |
| `done` | no | Completion note, typically a date and PR. |
| `closed_into` | no | For a closed task, the task that absorbed it. |

The format is a small subset of YAML: `key: value` and inline lists `[a, b]`.
Quote a value with double quotes when it starts with a YAML indicator (`` ` ``, `[`,
`"`, `*`…) or contains `: ` or ` #`; the CLI does this itself when it writes.
Unknown keys are an error, so a typo can't silently do nothing.

Prefer `tasks set` to editing frontmatter by hand: it validates ids, refuses
cycles, keeps the progress log's status mirror in step, and re-renders `TASKS.md`.
If you do edit by hand, run `tasks render` and `tasks check` after.

## Body

```markdown
# <Task Title>

## Goal

<What this task accomplishes and why, in 1–3 sentences. State the outcome, not
the steps.>

## Design

<The intended approach: the shape of the solution, key types/modules, important
decisions; what is known vs still open. Sketches welcome, not a full
implementation.>

## Implementation Suggestion

<Optional. Step order, helpers, gotchas, edge cases.>

## How to Verify

<The definition of done: concrete, runnable checks.>
```

- **Goal vs Design vs Verify** map to *what*, *how*, and *how we'll know*; keeping
  them apart keeps "done" objective.
- **No status in the body.** The frontmatter holds state; the story of the work
  goes in the progress log (`progress-md-format.md`). The file is the task's
  intent.
- **A `## Dependencies` section is optional** — prose on *why* each dependency
  exists, when that helps. The frontmatter is the record. If the section exists,
  `tasks set … deps+=x` / `deps-=x` adds or removes its link lines, and
  `tasks check` warns when an open task's section names a task its frontmatter
  doesn't (or the reverse). Links are relative to the file: a same-epic task is
  `history.md`, another epic's is `../eval/parser.md`. `tasks mv` and `tasks group`
  fix them when files move.

## Worked example

```markdown
---
title: Expression parser and evaluator
status: done
deps: []
summary: evaluate arithmetic strings; the pure core
done: 2026-06-13 #3
---
# Expression parser and evaluator

## Goal

Evaluate arithmetic expression strings (`"2+3*4"` → `14`). This is the
computational core — pure logic with no UI dependencies.

## Design

Recursive-descent grammar:

```
expr   = term (('+' | '-') term)*
term   = factor (('*' | '/') factor)*
factor = '-' factor | '(' expr ')' | number
```

Public API: `pub fn eval(input: &str) -> Result<f64, String>`. Division by zero
returns `Err("Division by zero")` so the UI can show it.

## How to Verify

`cargo test` passes, covering precedence (`"2+3*4"` → `14.0`), parentheses,
unary minus, and errors (`"1/0"`, `""`, `"2++3"` → `Err`).
```
