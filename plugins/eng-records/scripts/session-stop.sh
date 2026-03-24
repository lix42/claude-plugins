#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Read hook input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Find record file for this session
RECORD=$(find_record_by_session "$SESSION_ID")
if [ -z "$RECORD" ]; then
  exit 0
fi

# Extract last assistant message from transcript
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  # Get the last assistant message, extract text content, truncate to 300 chars
  SUMMARY=$(tail -r "$TRANSCRIPT_PATH" \
    | jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text' 2>/dev/null \
    | head -1 \
    | head -c 300 || true)

  if [ -n "$SUMMARY" ]; then
    TIMESTAMP=$(date +%H:%M:%S)
    {
      printf '\n## [%s] Claude\n' "$TIMESTAMP"
      printf '%s' "$SUMMARY"
      if [ ${#SUMMARY} -ge 300 ]; then
        printf '...'
      fi
      printf '\n'
    } >> "$RECORD"
  fi
fi

exit 0
