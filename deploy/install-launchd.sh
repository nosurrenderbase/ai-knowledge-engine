#!/bin/zsh
# Installs the launchd agent for this checkout (macOS). Does not start it:
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.nosurrender.kbsync.plist
set -euo pipefail

REPO="${0:A:h:h}"
TARGET="$HOME/Library/LaunchAgents/dev.nosurrender.kbsync.plist"

mkdir -p "$REPO/work/logs" "${TARGET:h}"
sed "s|__REPO__|$REPO|g" "$REPO/deploy/dev.nosurrender.kbsync.plist" > "$TARGET"
plutil -lint "$TARGET"
echo "kuruldu: $TARGET"
