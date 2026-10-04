#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
[[ $# -eq 0 || ( $# -eq 1 && "$1" = --rollback ) ]] || fail "Usage: bash ops/update.sh [--rollback]"
check_paths
check_plist
[[ -f "$PLIST" ]] && loaded || fail "Install this runtime's LaunchAgent first."
mkdir -p "$RT/data/logs"
if [[ "${1:-}" = --rollback ]]; then
  [[ -f "$RT/previous/server.js" && -d "$RT/previous/dist" ]] || fail "No previous code release available."
  launchctl bootout "$SERVICE"
  cp "$RT/previous/server.js" "$RT/server.js"
  rm -rf "$RT/dist"
  cp -R "$RT/previous/dist" "$RT/dist"
else
  build_stage
  launchctl bootout "$SERVICE"
  publish_stage
fi
"$BUN_PATH" "$REPO/ops/start-agent.js" "$RT" "$DOMAIN" "$PLIST"
echo "Own agent restarted; data and Serve configuration preserved."
