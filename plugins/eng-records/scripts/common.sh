#!/usr/bin/env bash
# Shared config for eng-records hooks
# Sources user config and sets RECORDS_DIR / REVIEWS_DIR

ENG_RECORDS_CONF="$HOME/.claude/eng-records.conf"
ENG_RECORDS_DEFAULT_DIR="$HOME/.claude/eng-records"

# Source user config if it exists
if [ -f "$ENG_RECORDS_CONF" ]; then
  # shellcheck source=/dev/null
  source "$ENG_RECORDS_CONF"
fi

# Apply defaults
ENG_DIR="${ENG_DIR:-$ENG_RECORDS_DEFAULT_DIR}"
RECORDS_DIR="${RECORDS_DIR:-$ENG_DIR/records}"
REVIEWS_DIR="${REVIEWS_DIR:-$ENG_DIR/reviews}"

# Ensure directories exist
mkdir -p "$RECORDS_DIR" "$REVIEWS_DIR"

# Helper: find record file for a given session_id
# Usage: find_record_by_session "$SESSION_ID"
find_record_by_session() {
  local sid="$1"
  grep -rl "session_id: $sid" "$RECORDS_DIR"/*.md 2>/dev/null | head -1 || true
}
