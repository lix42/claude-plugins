#!/usr/bin/env bash
set -euo pipefail

ENG_DIR="/Users/li.xu/Library/CloudStorage/GoogleDrive-devlix42@gmail.com/My Drive/Documents/engineering"
RECORDS_DIR="$ENG_DIR/records"

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
SOURCE=$(echo "$INPUT" | jq -r '.source // "startup"')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# For resume: find existing record file by session_id
if [ "$SOURCE" = "resume" ]; then
  EXISTING=$(grep -rl "session_id: $SESSION_ID" "$RECORDS_DIR"/*.md 2>/dev/null | head -1 || true)
  if [ -n "$EXISTING" ]; then
    # Append a resume marker
    printf '\n## [%s] Session Resumed\nProject: `%s`\n' "$(date +%H:%M:%S)" "$CWD" >> "$EXISTING"
    # Output the record path as env var for other hooks
    echo "{}"
    exit 0
  fi
fi

# Create new record file
TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%SZ)
DATE_PREFIX=$(date +%Y-%m-%d_%H%M%S)
SHORT_ID=$(echo "$SESSION_ID" | head -c 8)
FILENAME="${DATE_PREFIX}_${SHORT_ID}.md"
FILEPATH="$RECORDS_DIR/$FILENAME"

cat > "$FILEPATH" << FRONTMATTER
---
session_id: $SESSION_ID
started: $TIMESTAMP
project: $CWD
status: active
name: ""
transcript: $TRANSCRIPT_PATH
---

# Engineering Session Record

**Started:** $TIMESTAMP
**Project:** \`$CWD\`

FRONTMATTER

echo "{}"
exit 0
