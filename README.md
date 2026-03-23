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
    "eng-records@lix42": true
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
| `/eng-done` | Mark the session as done and generate an engineering review document |

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

When you run `/eng-done`, a review document is generated in the `reviews/` directory focusing on:

- Engineering decisions and trade-offs
- Technical approach and patterns used
- Challenges encountered and how they were solved
- Skills demonstrated

These are structured for use in behavioral interviews and promotion documents.
