#!/bin/zsh
# Starts the sync worker (launchd or by hand). Arguments go to the worker: deploy/run.sh once
set -euo pipefail

REPO="${0:A:h:h}"

set -a
source "$REPO/deploy/kbsync.env"
set +a

# launchd does not load the shell profile: node and claude come from PATH_PREFIX.
export PATH="${PATH_PREFIX:+$PATH_PREFIX:}/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$REPO/apps/sync"
exec node src/main.ts "$@"
