---
allowed-tools: Read, Edit, Grep, Glob, Bash
description: Set a friendly name for the current session's engineering record
user-invocable: true
args: name - The name to assign to this session record
---

# /eng-name — Name the Current Session Record

You are helping the user set a friendly name on the current session's engineering record.

## Steps

1. The user provides a name as the argument: `$ARGUMENTS`

2. **Find the current session's record file:**
   - Search in: `/Users/li.xu/Library/CloudStorage/GoogleDrive-devlix42@gmail.com/My Drive/Documents/engineering/records/`
   - Look for the file matching the current session ID, or the most recently modified `status: active` file

3. **Update the frontmatter:** Change `name: ""` (or whatever the current name is) to `name: <user's name>`

4. **Confirm** to the user that the name was set.
