# claude-plugins

Custom Claude Code plugins by [lix42](https://github.com/lix42).

## Installation

Add this marketplace to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "extraKnownMarketplaces": {
    "lix42": {
      "source": {
        "source": "git",
        "url": "https://github.com/lix42/claude-plugins.git"
      }
    }
  }
}
```

Then enable individual plugins under `enabledPlugins`:

```json
{
  "enabledPlugins": {
    "eng-records@lix42": true,
    "tasks@lix42": true,
    "ship@lix42": true
  }
}
```

## Plugins

### eng-records

Automatically records engineering sessions and generates review documents for behavioral interviews and promotion docs.

#### How it works

Hooks run in the background during every Claude Code session:

- **SessionStart** — Creates a new record file (or resumes an existing one for `--continue`/`--resume`)
- **UserPromptSubmit** — Appends each user prompt with a timestamp
- **Stop** — Extracts the last Claude response summary from the transcript

Records are markdown files named `yyyy-mm-dd-{project}-{branch}-{seq}.md` with YAML frontmatter tracking session ID, project path, and status.

#### Commands

| Command | Description |
|---------|-------------|
| `/eng-init [path]` | Configure where records are stored (default: `~/.claude/eng-records/`) |
| `/eng-name <name>` | Set a friendly name on the current session's record |
| `/eng-done` | Mark the current session as done and generate an engineering review document |
| `/eng-review [targets]` | Generate review docs from existing records, grouping records that belong to the same work |

##### `/eng-review` — for records the current session didn't `/eng-done`

Sometimes a single piece of work ends up in several record files — a feature branch was created mid-session, work spanned multiple days, or `/eng-done` was never run. `/eng-review` handles these after the fact.

Argument forms:

- `/eng-review` — review all records that don't yet have a `review:` pointer in their frontmatter (the "I forgot `/eng-done`" recovery path).
- `/eng-review <file…>` or globs (e.g. `2026-05-*.md`) — review specific records.
- `/eng-review --name "auth refactor"` — review all records with a matching `name:`.
- `/eng-review --since 2026-05-01` — restrict to records started on or after that date.

When given multiple records, `/eng-review` groups them before writing:

1. Records sharing a non-empty `name:` merge into one review (strongest signal — user-asserted).
2. Records on the same project + same branch + within 7 days merge.
3. Records on the same project with clear topical overlap (same files/feature) merge.
4. Otherwise records go into separate reviews.

The command prints its grouping plan before writing so you can interrupt if it's wrong. After writing, each consumed record's frontmatter is stamped with a `review:` back-pointer, so re-runs are idempotent.

#### Configuration

Records directory is configurable via `~/.claude/eng-records.conf`:

```bash
# Base directory (records/ and reviews/ are created inside)
ENG_DIR="$HOME/.claude/eng-records"

# Optional: override individual paths
# RECORDS_DIR="/custom/path/to/records"
# REVIEWS_DIR="/custom/path/to/reviews"
```

Run `/eng-init` to set this up interactively.

#### Record file format

```markdown
---
session_id: abc123
started: 2026-03-21T10:00:00Z
project: /path/to/project
status: active
name: "auth refactor"
transcript: /path/to/transcript.jsonl
---

# Engineering Session Record

**Started:** 2026-03-21T10:00:00Z
**Project:** `/path/to/project`
**Branch:** `main`

## [10:00:00] User
fix the auth middleware to validate tokens properly

## [10:00:15] Claude
I'll update the auth middleware to add proper JWT validation...
```

#### Review documents

When you run `/eng-done` or `/eng-review`, a review document is generated in the `reviews/` directory focusing on:

- Engineering decisions and trade-offs
- Technical approach and patterns used
- Challenges encountered and how they were solved
- Skills demonstrated

These are structured for use in behavioral interviews and promotion documents.

### tasks

Plan a project into a `docs/TASKS.md` index plus one file per task under
`docs/tasks/`, connected by a dependency graph — so you always know what's ready
to work on next.

#### Layout it manages

```
docs/
  TASKS.md           # design summary + dependency graph + task checklist
  tasks/<name>.md    # one file per task (goal, design, how to verify, deps)
  design.md          # optional: full design spec if it outgrows TASKS.md
```

`TASKS.md` has three sections: a concise **Design**, a **Dependencies** graph
(Mermaid diagram + a machine-readable list that's the source of truth for what's
unblocked), and the **Tasks** checklist (`[ ]` todo · `[~]` in progress · `[x]`
done), optionally grouped into phases.

#### Commands

| Command | Description |
|---------|-------------|
| `/tasks-setup [requirement]` | Interview, agree on a design, split into tasks, and (after approval) write `TASKS.md` + task files |
| `/tasks-next` | List tasks whose dependencies are all done, with priority and parallelism suggestions |
| `/tasks-update [change]` | Add/remove/split/change tasks and keep the dependency graph consistent |
| `/tasks-done [task]` | Mark a task complete and show what it just unblocked |

The bundled `task-tracking` skill also triggers automatically when you ask about
the plan, what to work on next, or say a piece of work is done — so you don't have
to remember the commands.

### ship

Take a finished change from "done writing code" to "ready to merge" in one step.

Run `/ship` after finishing a task. It works these steps in order, adapting to
whatever tools the session has:

1. **Quality gates** — discover and run the project's type-check / test / build /
   lint commands and fix any failures (never ships past a red gate).
2. **Code review** — uses `pr-review-toolkit:review-pr` if available, else another
   review skill/subagent, else a critical self-review; acts on the findings.
3. **Docs** — updates `CLAUDE.md` via `claude-md-management:revise-claude-md` if
   available, else from the session's lessons learned.
4. **Task** — if `docs/TASKS.md` exists and the session worked a task, marks it
   `[x]` (via `tasks:tasks-done` when available).
5. **PR** — if there's a GitHub remote: branch if needed, then commit + push +
   open a PR (via `commit-commands:commit-push-pr` if available, else `gh`).
6. **Drive to green** — polls PR checks, fixes failures and pushes, rebases onto
   the default branch when the PR falls behind, and reads/answers review comments.
   Stops once green — the final merge is left to you.
7. **No remote** — if there's no GitHub remote, rebases onto `main` and
   fast-forward merges to keep history linear (safe for parallel worktrees).

The `ship` skill also triggers when you say things like "ship it" or "ready to
open a PR."
