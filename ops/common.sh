#!/bin/bash
set -euo pipefail
umask 077
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RT="$HOME/Library/Application Support/ledger-app"
PLIST="$HOME/Library/LaunchAgents/local.ledger-app.plist"
DOMAIN="gui/$(id -u)"
SERVICE="$DOMAIN/local.ledger-app"
MODULE_PATH="$HOME/.local/share/ddolmeng-mode/bin/ledger.ts"
WATCH_PATH="$HOME/.local/share/ddolmeng-mode/state/ledger"
BUN_PATH="$(command -v bun)"
[[ "$BUN_PATH" = /* && -x "$BUN_PATH" ]] || { echo "Absolute Bun executable required." >&2; exit 1; }
export RT BUN_PATH MODULE_PATH WATCH_PATH
fail() { echo "$*" >&2; exit 1; }
check_paths() {
  [[ "$RT" != */Documents/* && ! -L "$RT" && ! -L "$RT/data" && ! -L "$RT/data/logs" ]] ||
    fail "Runtime and data must be real directories outside Documents."
  [[ ! -L "$PLIST" ]] || fail "Refusing a symlinked LaunchAgent plist."
  for path in "$RT/server.js" "$RT/dist" "$RT/previous" "$RT/serve-4340.owned" \
    "$RT/data/logs/server.log" "$RT/data/logs/server-error.log"; do
    [[ ! -L "$path" ]] || fail "Refusing symlinked runtime artifacts."
  done
  "$BUN_PATH" -e '
    const fs = require("node:fs");
    let p = process.env.RT;
    while (!fs.existsSync(p)) p = require("node:path").dirname(p);
    if (fs.realpathSync(p).includes("/Documents/") || fs.realpathSync(p).endsWith("/Documents")) process.exit(1);
  ' || fail "Resolved runtime parent is under Documents."
}
serve_state() {
  tailscale serve status --json | "$BUN_PATH" "$REPO/ops/config.js" serve
}
loaded() { launchctl print "$SERVICE" >/dev/null 2>&1; }
check_plist() {
  if [[ -e "$PLIST" ]]; then
    [[ "$(/usr/libexec/PlistBuddy -c 'Print :Label' "$PLIST")" = local.ledger-app &&
       "$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$PLIST")" = "$RT" ]] ||
      fail "Existing plist is not this runtime's agent."
  elif loaded; then
    fail "Loaded label has no owned plist; refusing to restart."
  fi
}
check_repo_data() {
  if [[ -L "$REPO/data" ]]; then
    [[ "$(readlink "$REPO/data")" = "$RT/data" ]] || fail "Existing repo data symlink differs; preserve it."
  elif [[ -e "$REPO/data" ]]; then
    [[ -d "$REPO/data" && -z "$(find "$REPO/data" -mindepth 1 -maxdepth 1 -print -quit)" ]] ||
      fail "Repo data is not empty; migrate it manually before installing."
  fi
}
link_repo_data() {
  check_repo_data
  if [[ ! -L "$REPO/data" ]]; then
    [[ ! -d "$REPO/data" ]] || rmdir "$REPO/data"
    ln -s "$RT/data" "$REPO/data"
  fi
}
build_stage() {
  command -v heavy >/dev/null || fail "heavy is required."
  STAGE="$(mktemp -d "$RT/.stage.XXXXXX")"
  trap 'rm -rf "$STAGE"' EXIT
  (
    cd "$REPO"
    heavy "$BUN_PATH" run build >&2
    heavy "$BUN_PATH" build server/index.ts --target bun --outfile "$STAGE/server.js" >&2
  )
  cp -R "$REPO/dist" "$STAGE/dist"
  "$BUN_PATH" "$REPO/ops/preflight.js" "$STAGE" >&2
}
publish_stage() {
  # Keep one prior code release. Never copy or modify production data here.
  rm -rf "$RT/previous"
  mkdir -p "$RT/previous"
  [[ ! -f "$RT/server.js" ]] || cp "$RT/server.js" "$RT/previous/server.js"
  [[ ! -d "$RT/dist" ]] || cp -R "$RT/dist" "$RT/previous/dist"
  mv "$STAGE/server.js" "$RT/server.js"
  rm -rf "$RT/dist"
  mv "$STAGE/dist" "$RT/dist"
}
