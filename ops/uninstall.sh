#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
[[ $# -eq 0 || ( $# -eq 1 && "$1" = --purge ) ]] || fail "Usage: bash ops/uninstall.sh [--purge]"
check_paths
check_plist
if [[ "${1:-}" = --purge ]]; then
  [[ "${LEDGER_CONFIRM_PURGE:-}" = 'DELETE ledger-app data' ]] ||
    fail "Purge requires LEDGER_CONFIRM_PURGE='DELETE ledger-app data' and a private backup."
  check_repo_data
fi
# A matching entry without our marker belongs to its original installer.
if [[ -f "$RT/serve-4340.owned" ]]; then
  STATE="$(serve_state)" # A conflict aborts before stopping anything.
else
  STATE=unowned
fi
if loaded; then launchctl bootout "$SERVICE"; fi
rm -f "$PLIST"
if [[ "$STATE" = matching ]]; then
  tailscale serve --https=4340 off
fi
rm -f "$RT/serve-4340.owned" "$RT/server.js"
rm -rf "$RT/dist" "$RT/previous"
if [[ "${1:-}" = --purge ]]; then
  if [[ -L "$REPO/data" ]]; then rm "$REPO/data"; fi
  rm -rf "$RT/data"
  echo "Own runtime removed, including explicitly confirmed data purge."
else
  echo "Own runtime removed; data and repo data symlink retained."
fi
