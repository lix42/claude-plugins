#!/usr/bin/env bash
set -euo pipefail

ENG_DIR="/Users/li.xu/Library/CloudStorage/GoogleDrive-devlix42@gmail.com/My Drive/Documents/engineering"
RECORDS_DIR="$ENG_DIR/records"

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

if [ -z "$SESSION_ID" ] || [ -z "$PROMPT" ]; then
  exit 0
fi

# Find record file for this session
RECORD=$(grep -rl "session_id: $SESSION_ID" "$RECORDS_DIR"/*.md 2>/dev/null | head -1 || true)
if [ -z "$RECORD" ]; then
  exit 0
fi

# Skip recording slash commands that are part of eng-records itself
case "$PROMPT" in
  /eng-done*|/eng-name*|/eng-review*)
    exit 0
    ;;
esac

# Append user prompt with timestamp
TIMESTAMP=$(date +%H:%M:%S)
{
  printf '\n## [%s] User\n' "$TIMESTAMP"
  printf '%s\n' "$PROMPT"
} >> "$RECORD"

exit 0
