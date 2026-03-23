#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

if [ -z "$SESSION_ID" ] || [ -z "$PROMPT" ]; then
  exit 0
fi

# Find record file for this session
RECORD=$(find_record_by_session "$SESSION_ID")
if [ -z "$RECORD" ]; then
  exit 0
fi

# Skip recording slash commands that are part of eng-records itself
case "$PROMPT" in
  /eng-done*|/eng-name*|/eng-review*|/eng-init*)
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
