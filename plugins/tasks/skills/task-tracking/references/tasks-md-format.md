# TASKS.md, `_header.md` and `_epic.md`

`docs/TASKS.md` is **generated** by `tasks render` (and by every command that changes
a task). It is the human-readable index of the plan; nothing reads it back. Never
edit it — `tasks check` fails when it differs from what the task files render to.

## What it contains

1. A generated-file marker.
2. **The header** — `docs/tasks/_header.md`, verbatim.
3. **Dependencies** — in flat mode a Mermaid graph of every task that isn't
   closed; in epic mode the **epic rollup** (one node per epic, an edge wherever an
   open task depends on a task in another epic). A 200-task diagram helps no one, so
   epic mode doesn't draw tasks; `tasks deps`/`unblocks`/`show` answer task-level
   questions.
4. **Tasks** — in epic mode one `### <epic> — [progress](progress/<epic>.md)`
   heading per epic (ordered by `_epic.md`'s `order`), its scope as a blockquote;
   then each task as `- [<box>] [Title](tasks/<id>.md) — <summary>`, with
   **waits on** naming any unfinished deps and the priority marker. Within an epic:
   doing, todo, done, closed, each alphabetical.

Boxes: `[ ]` todo · `[~]` doing · `[x]` done · `[-]` closed.

A rollup cycle is not a defect: an acyclic task graph can project onto epics as a
cycle. Only the task graph must be acyclic.

## `docs/tasks/_header.md` (hand-written)

The top of `TASKS.md`. Keep it short:

```markdown
# Calc — Tasks

A TUI calculator. See [design.md](design.md) for the full design.

> **Progress log:** [progress.md](progress.md) records *how* each task is carried
> out. Read it before starting a task; log as you work with `tasks log <id> "…"`.

## Design

### Overview
A keyboard- and mouse-driven TUI calculator.

### Architecture
- `eval` — parser/evaluator. Pure logic, no UI.
- `app` — application state machine.
- `ui` — renders the display and the button grid.
```

- **Design**: a concise high-level design so anyone can pick up the project. When
  it grows past a screen or two, move the detail to `docs/design.md` and leave a
  summary and a link. In epic mode the Architecture bullets should line up with the
  epics — if they've drifted apart, one of the two is wrong.
- **Progress-log note**: in epic mode it points at `progress/` and says to read
  your epic's whole file plus the `Epic summary` of every epic you depend on.
- Links are relative to `docs/`, since the header lands in `docs/TASKS.md`.

## `docs/tasks/<epic>/_epic.md` (epic mode)

```markdown
---
title: Expression evaluation
order: 1
---

Parsing, precedence, and the numeric representation.
```

`order` places the epic in `TASKS.md`; the body is the scope line under its
heading. `tasks new` and `tasks mv` create one, ordered last, when they meet a new
epic — fill in its title and scope.
