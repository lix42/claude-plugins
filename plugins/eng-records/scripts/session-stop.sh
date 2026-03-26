#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Find record file for this session
RECORD=$(find_record_by_session "$SESSION_ID")
if [ -z "$RECORD" ]; then
  exit 0
fi

# Extract last assistant message from hook input
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty')

if [ -n "$LAST_MSG" ]; then
  if [ ${#LAST_MSG} -le 1000 ]; then
    SUMMARY="$LAST_MSG"
  else
    SUMMARY=$(printf '%s' "$LAST_MSG" | claude -p --max-tokens 300 \
      "Summarize this in 2-4 sentences, focusing on what was accomplished:" 2>/dev/null) \
      || SUMMARY="$(printf '%s' "$LAST_MSG" | head -c 1000)..."
  fi
  TIMESTAMP=$(date +%H:%M:%S)
  {
    printf '\n## [%s] Claude\n' "$TIMESTAMP"
    printf '%s\n' "$SUMMARY"
  } >> "$RECORD"
fi

exit 0
