---
allowed-tools: Read, Write, Edit, Bash
description: Initialize eng-records configuration with a custom directory path
user-invocable: true
args: path - (optional) Directory path for engineering records. Defaults to ~/.claude/eng-records
---

# /eng-init — Configure Engineering Records Directory

You are helping the user set up the eng-records plugin configuration.

## Steps

1. **Determine the target directory:**
   - If the user provided a path as `$ARGUMENTS`, use that (expand `~` to `$HOME`)
   - If no argument, ask the user where they want records stored, suggesting `~/.claude/eng-records` as default

2. **Create the config file** at `~/.claude/eng-records.conf`:
   ```bash
   # eng-records configuration
   # ENG_DIR: base directory for engineering records
   # RECORDS_DIR and REVIEWS_DIR default to $ENG_DIR/records and $ENG_DIR/reviews
   ENG_DIR="/absolute/path/to/chosen/dir"
   ```

   If the user wants separate paths for records and reviews, also set:
   ```bash
   RECORDS_DIR="/path/to/records"
   REVIEWS_DIR="/path/to/reviews"
   ```

3. **Create the directories** (records/ and reviews/ under the chosen path).

4. **Confirm** to the user:
   - Config written to `~/.claude/eng-records.conf`
   - Records will be saved to `<path>/records/`
   - Reviews will be saved to `<path>/reviews/`
   - Mention they can edit `~/.claude/eng-records.conf` directly anytime
