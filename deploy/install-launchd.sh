#!/bin/zsh
# Installs the launchd agents for this checkout (macOS): the sync worker and the deploy job.
# Does not start them:
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.nosurrender.kbsync.plist
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.nosurrender.kbdeploy.plist
# To apply a changed plist to a running agent: launchctl bootout gui/$(id -u)/<label>, then bootstrap.
set -euo pipefail

REPO="${0:A:h:h}"
mkdir -p "$REPO/work/logs" "$HOME/Library/LaunchAgents"
for label in dev.nosurrender.kbsync dev.nosurrender.kbdeploy; do
  TARGET="$HOME/Library/LaunchAgents/$label.plist"
  sed "s|__REPO__|$REPO|g" "$REPO/deploy/$label.plist" > "$TARGET"
  plutil -lint "$TARGET"
  echo "kuruldu: $TARGET"
done
