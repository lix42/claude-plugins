---
allowed-tools: Read, Edit, Grep, Glob, Bash
description: Set a friendly name for the current session's engineering record
user-invocable: true
args: name - The name to assign to this session record
---

# /eng-name — Name the Current Session Record

You are helping the user set a friendly name on the current session's engineering record.

## Resolving Paths

First, read `~/.claude/eng-records.conf` to get the configured directories. If the file doesn't exist, use defaults:
- `RECORDS_DIR`: `~/.claude/eng-records/records`

## Steps

1. The user provides a name as the argument: `$ARGUMENTS`

2. **Find the current session's record file:**
   - Search in RECORDS_DIR for the file matching the current session ID, or the most recently modified `status: active` file

3. **Update the frontmatter:** Change `name: ""` (or whatever the current name is) to `name: <user's name>`

4. **Confirm** to the user that the name was set.
