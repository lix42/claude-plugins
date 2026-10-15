---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Group an oversized flat task plan into structural epics and split the progress log per epic
user-invocable: true
args: hint - (optional) grouping guidance, e.g. "keep the CLI work together" or a proposed epic list. If omitted, derive the grouping from the design and dependency structure.
---

# /tasks-group — Group tasks into epics

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Group a flat plan
into epics** operation. `tasks` means `node ${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/cli/tasks.ts`.

**`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/references/epics.md` is authoritative —
read it and follow its "Grouping a flat plan into epics" procedure.**

Grouping guidance from the user is in `$ARGUMENTS` — a strong steer, but check it
against the code's structure and the dependency graph, and say so if it cuts across
subsystems. If the plan is under every trigger in `epics.md`, say it doesn't need
epics and leave it alone.

Group by structure (never by phase or story headings), **propose every task's new
id and get explicit approval**, then write the map and run
`tasks group <map.json> --dry-run` followed by `tasks group <map.json>`. Finish the
hand-written parts (the header's progress-log note, each `Epic summary`), run
`tasks check`, and leave the diff uncommitted for the user to review.
