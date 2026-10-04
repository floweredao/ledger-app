#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
[[ $# -eq 0 || ( $# -eq 1 && "$1" = --dry-run ) ]] || fail "Usage: bash ops/install.sh [--dry-run]"
check_paths
check_plist
check_repo_data
STATE="$(serve_state)" # Refuse all conflicting 4340 configurations before writes.
STATUS="$(tailscale status --json)" # Private shell variable, never logged.
URL="$(printf '%s' "$STATUS" | "$BUN_PATH" "$REPO/ops/config.js" url)"
[[ -r "$MODULE_PATH" && -d "$WATCH_PATH" ]] || fail "Read-only ledger module/watch directory required."
if [[ "${1:-}" = --dry-run ]]; then
  echo "PLAN ONLY: heavy build; isolated preflight; copy runtime; reload $SERVICE."
  if [[ "$STATE" = absent ]]; then
    echo "PLAN ONLY: tailscale serve --bg --https=4340 http://127.0.0.1:4340"
  else
    echo "PLAN ONLY: keep existing matching Serve 4340 mapping (not adopted)."
  fi
  echo "$URL"
  exit 0
fi
if ! loaded && lsof -nP -iTCP:4340 -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port 4340 is occupied without our loaded agent."
fi
mkdir -p "$RT/data/logs" "$(dirname "$PLIST")"
chmod 700 "$RT" "$RT/data" "$RT/data/logs"
build_stage
printf '%s' "$STATUS" | "$BUN_PATH" "$REPO/ops/config.js" render \
  "$REPO/ops/local.ledger-app.plist.template" > "$STAGE/agent.plist"
plutil -lint "$STAGE/agent.plist" >&2
if loaded; then launchctl bootout "$SERVICE"; fi
publish_stage
link_repo_data
cp "$STAGE/agent.plist" "$PLIST"
# Contains private LoginName: owner-only, unlike the non-secret template.
chmod 600 "$PLIST"
launchctl enable "$SERVICE"
"$BUN_PATH" "$REPO/ops/start-agent.js" "$RT" "$DOMAIN" "$PLIST"
STATE="$(serve_state)" # Re-check immediately before changing Serve.
if [[ "$STATE" = absent ]]; then
  tailscale serve --bg --https=4340 http://127.0.0.1:4340 >&2
  : > "$RT/serve-4340.owned"
fi
printf '%s\n' "$URL"
