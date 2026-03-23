#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

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
  EXISTING=$(find_record_by_session "$SESSION_ID")
  if [ -n "$EXISTING" ]; then
    printf '\n## [%s] Session Resumed\nProject: `%s`\n' "$(date +%H:%M:%S)" "$CWD" >> "$EXISTING"
    echo "{}"
    exit 0
  fi
fi

# Derive folder name and branch name from CWD
FOLDER_NAME=""
BRANCH_NAME=""
if [ -n "$CWD" ]; then
  FOLDER_NAME=$(basename "$CWD")
  # Get git branch if in a git repo
  BRANCH_NAME=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
fi

# Sanitize for filename: lowercase, replace non-alphanumeric with hyphens, collapse
sanitize() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//'
}

FOLDER_PART=$(sanitize "${FOLDER_NAME:-unknown}")
BRANCH_PART=$(sanitize "${BRANCH_NAME:-no-branch}")
DATE_PART=$(date +%Y-%m-%d)

# Determine sequence number: count existing files with same date+folder+branch prefix
PREFIX="${DATE_PART}-${FOLDER_PART}-${BRANCH_PART}"
SEQ=1
while [ -f "$RECORDS_DIR/${PREFIX}-${SEQ}.md" ]; do
  SEQ=$((SEQ + 1))
done

FILENAME="${PREFIX}-${SEQ}.md"
FILEPATH="$RECORDS_DIR/$FILENAME"
TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%SZ)

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
**Branch:** \`${BRANCH_NAME:-n/a}\`

FRONTMATTER

echo "{}"
exit 0
