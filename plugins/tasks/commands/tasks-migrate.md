---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Convert an old-format plan (status checkboxes in TASKS.md) to frontmatter task files and a generated TASKS.md
user-invocable: true
---

# /tasks-migrate — Move a plan to the frontmatter format

Load the task-tracking workflow at
`${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/SKILL.md` and run its **Migrate an
old-format plan** operation. `tasks` means `node ${CLAUDE_PLUGIN_ROOT}/skills/task-tracking/cli/tasks.ts`.

1. Check the git tree is clean; stop and say so if it isn't.
2. `tasks migrate --dry-run`, and walk the user through the report — counts by
   status, where deps came from, stub files, unlisted files (migrated as closed),
   and each disagreement. Get approval.
3. `tasks migrate`, then `tasks check`.
4. Review `docs/tasks/_header.md` with the user (it is the old preamble; trim
   what's stale), resolve the disagreements and warnings `check` reported, and leave
   the diff uncommitted for them to review.
