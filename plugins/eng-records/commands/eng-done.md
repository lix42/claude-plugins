---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Mark current session as done and generate an engineering review document
user-invocable: true
---

# /eng-done — Mark Session Done & Generate Review

You are helping the user finalize the current engineering session record and create a review document for it.

## Resolving Paths

Read `~/.claude/eng-records.conf` to get the configured directories. If the file doesn't exist, use defaults:
- `RECORDS_DIR`: `~/.claude/eng-records/records`
- `REVIEWS_DIR`: `~/.claude/eng-records/reviews`

## Steps

1. **Find the current session's record file.**
   - Search for files matching the current session ID in `RECORDS_DIR` (`grep -rl "session_id: $SESSION_ID"`), or fall back to the most recently modified file with `status: active`.
   - If you can't find one, tell the user and stop.

2. **Flip the record's status.** Update the frontmatter: `status: active` → `status: done`.

3. **Generate the review.** Delegate to the `create-review` skill with this single record file as input. The skill will:
   - Look for an existing review covering this work and update it, or create a new one.
   - Stamp the record's frontmatter with a `review:` back-pointer.

4. **Tell the user** the paths to both the updated record and the review doc.

> Need to review records from prior sessions (e.g., you forgot to run `/eng-done`, or one piece of work spans multiple records)? Use `/eng-review` instead — it accepts multiple records and groups them intelligently.
