#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
XMARKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VAULT_PATH="$HOME/Obsidian/xmarks"
NPX_PATH="$(which npx 2>/dev/null || echo "/opt/homebrew/bin/npx")"

PLIST_NAME="com.xmarks.daemon.plist"
PLIST_TEMPLATE="$SCRIPT_DIR/$PLIST_NAME.template"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo ""
echo "  xmarks — install launchd service"
echo "  ─────────────────────────────────"
echo "  Project: $XMARKS_DIR"
echo "  Vault:   $VAULT_PATH"
echo "  npx:     $NPX_PATH"

# Unload if already loaded
if launchctl list | grep -q com.xmarks.daemon 2>/dev/null; then
  echo "  Stopping existing service..."
  launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

# Generate plist from template
sed \
  -e "s|__XMARKS_DIR__|$XMARKS_DIR|g" \
  -e "s|__VAULT_PATH__|$VAULT_PATH|g" \
  -e "s|__NPX_PATH__|$NPX_PATH|g" \
  "$PLIST_TEMPLATE" > "$PLIST_DST"
echo "  Generated: $PLIST_DST"

# Load
launchctl load "$PLIST_DST"
echo "  Service started!"
echo ""
echo "  Commands:"
echo "    launchctl stop com.xmarks.daemon     # Stop"
echo "    launchctl start com.xmarks.daemon    # Start"
echo "    launchctl unload $PLIST_DST          # Uninstall"
echo ""
echo "  Logs:"
echo "    tail -f $VAULT_PATH/daemon.stdout.log"
echo "    tail -f $VAULT_PATH/daemon.stderr.log"
echo ""
