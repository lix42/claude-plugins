# Per-task file format

Each task gets one file, and its path matches the id used in `TASKS.md`:

- **Flat mode** — `docs/tasks/<task-name>.md`, id `<task-name>`.
- **Epic mode** — `docs/tasks/<epic>/<task-name>.md`, id `<epic>/<task-name>`.

Both are kebab-case. The file expands the task enough that someone can implement
it without re-asking what it's for — while leaving the actual implementation to
the implementer. The file's content is identical in both modes; only its location
and the relative links in its Dependencies section differ.

## Structure

```markdown
# <Task Title>

## Goal

<What this task accomplishes and why, in 1–3 sentences. State the outcome, not
the steps. If it helps, name the inputs and outputs.>

## Design

<The intended approach: the shape of the solution, key types/functions/modules,
file locations, data flow, important decisions. Code sketches are welcome — they
anchor the design — but keep them illustrative, not a full implementation.>

## Implementation Suggestion

<Optional. Concrete hints that save the implementer time: a step order, helper
functions, gotchas, edge cases to watch. Omit this section if the Design already
makes the path obvious.>

## How to Verify

<How to know it works. Prefer concrete, runnable checks: the test command,
specific test cases (input → expected output), or manual steps to observe. This
is the task's definition of done.>

## Dependencies

<Tasks that must be done first, as links. Mirror the canonical list in TASKS.md.
Write "None — ..." with a short reason when there are no dependencies.>

- [Other task title](other-task.md)
```

## Notes

- **Goal vs Design vs Verify** map to *what*, *how*, and *how we'll know*. Keeping
  them separate makes a task skimmable and keeps "done" objective.
- The **Dependencies** section mirrors `TASKS.md`'s canonical dependency list. If
  they ever disagree, `TASKS.md` wins — fix the mismatch. Links are relative from
  this file:
  - Flat mode: `[Diff computation](diff-computation.md)`.
  - Epic mode, same epic: `[Working space](working-space.md)`.
  - Epic mode, another epic: `[Shared types](../core/types.md)`.

  Moving a task between epics changes the hop count in **both** directions — its
  own links and every link pointing at it. Fix both.
- This file is the task's **spec** (what to build and how it's meant to work), not
  its execution log. The running account of how the work actually went — decisions,
  what worked, what didn't — goes in the progress log (`docs/progress.md` in flat
  mode, `docs/progress/<epic>.md` in epic mode; see `progress-md-format.md`), one
  section per task. Keep this file about intent.
- Optionally record completion inline when a task is marked done, e.g. a short
  `**Done:** <date / PR / note>` line under the title, so the file reflects state
  too. The checkbox in `TASKS.md` remains the authoritative status.

## Worked example

```markdown
# Expression Parser and Evaluator

## Goal

Evaluate arithmetic expression strings (`"2+3*4"` → `14`). This is the
computational core — pure logic with no UI dependencies.

## Design

Recursive-descent grammar:

```
expr   = term (('+' | '-') term)*
term   = factor (('*' | '/') factor)*
factor = '-' factor | '(' expr ')' | number
number = [0-9]+ ('.' [0-9]+)?
```

Public API: `pub fn eval(input: &str) -> Result<f64, String>`. A private
`Parser { chars, pos }` holds state; one method per grammar rule. Division by
zero returns `Err("Division by zero")` so the UI can show it.

## Implementation Suggestion

- `peek()` / `advance()` cursor helpers; skip whitespace between tokens.
- After parsing, assert the cursor reached end-of-input to catch trailing junk.

## How to Verify

`cargo test` passes, covering:
- Precedence: `"2+3*4"` → `14.0`
- Parentheses: `"(2+3)*4"` → `20.0`
- Unary minus: `"-(3+2)"` → `-5.0`
- Errors: `"1/0"`, `""`, `"2++3"` → `Err`

## Dependencies

None — standalone module with no dependencies on other tasks.
```

## Dependencies in epic mode

The only thing that changes is link depth, and getting it wrong is the most common
breakage when tasks move. For `docs/tasks/app/state.md` — task id `app/state`,
depending on `app/history` (same epic) and `eval/parser` plus `term/key-decode`
(other epics):

```markdown
## Dependencies

- [Expression history](history.md)
- [Expression parser](../eval/parser.md)
- [Key decoding and chords](../term/key-decode.md)
```

Same epic is a bare filename; another epic is `../<epic>/<task>.md`. There is never
more than one `../`, because every task file sits exactly one level under
`docs/tasks/`.
