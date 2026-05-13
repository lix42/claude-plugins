---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
description: Generate engineering review documents from one or more record files, grouping records that belong to the same work
user-invocable: true
args: targets - (optional) record file paths, globs, --name <name>, --since <yyyy-mm-dd>, or empty to review all un-reviewed records
---

# /eng-review — Generate Reviews From Records

You are helping the user generate engineering review documents from session records. Unlike `/eng-done`, this command operates on records after the fact and can handle multiple records at once — including the case where one piece of work was split across several record files (different branches, different days, or because the user forgot to run `/eng-done`).

## Resolving Paths

Read `~/.claude/eng-records.conf` to get the configured directories. If the file doesn't exist, use defaults:
- `RECORDS_DIR`: `~/.claude/eng-records/records`
- `REVIEWS_DIR`: `~/.claude/eng-records/reviews`

## Steps

### 1. Resolve `$ARGUMENTS` to a concrete list of record files

The argument string may take any of these forms (and may combine `--since`/`--name` with explicit paths):

- **Empty** → find all records in `RECORDS_DIR` whose frontmatter has no `review:` key (or `review:` is empty). This is the "I forgot to run `/eng-done`" recovery path.
- **One or more paths or globs** (e.g., `2026-05-*.md` or two filenames) → resolve to concrete record files. Paths may be relative to `RECORDS_DIR`.
- **`--name <name>`** → all records whose frontmatter `name:` matches (case-insensitive substring is fine).
- **`--since <yyyy-mm-dd>`** → restrict to records with `started:` on or after that date.

After resolution, you should have a deduplicated list of absolute record file paths.

If the list is empty, tell the user (e.g., "No un-reviewed records found") and stop.

### 2. Delegate to the `create-review` skill

Invoke the `create-review` skill with the resolved record list. The skill will:
- Group records that belong to the same work (same `name`, or same project+branch+adjacent dates, or same project with clear topical overlap).
- Print the grouping plan before writing.
- Create or update each review doc.
- Stamp each consumed record's frontmatter with a `review:` back-pointer so subsequent `/eng-review` calls with no arguments skip them.

### 3. Report

Once the skill returns, summarize for the user:
- How many records were processed.
- How many review docs were created vs. updated, with their paths.
- Anything that looked ambiguous in the grouping decision (so the user can intervene if needed).
