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
  # Truncate to 300 chars
  SUMMARY=$(printf '%s' "$LAST_MSG" | head -c 300)
  TIMESTAMP=$(date +%H:%M:%S)
  {
    printf '\n## [%s] Claude\n' "$TIMESTAMP"
    printf '%s' "$SUMMARY"
    if [ ${#LAST_MSG} -gt 300 ]; then
      printf '...'
    fi
    printf '\n'
  } >> "$RECORD"
fi

exit 0
