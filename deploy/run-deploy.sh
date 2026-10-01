#!/bin/zsh
# One deploy round (launchd every 2 minutes, or by hand): see apps/deploy/src/deploy.ts.
set -euo pipefail

REPO="${0:A:h:h}"

set -a
[[ -f "$REPO/.env" ]] && source "$REPO/.env"
source "$REPO/deploy/kbsync.env"
set +a

# launchd does not load the shell profile: node from PATH_PREFIX, docker from Homebrew/OrbStack.
export PATH="${PATH_PREFIX:+$PATH_PREFIX:}/opt/homebrew/bin:/usr/local/bin:$HOME/.orbstack/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$REPO"
exec node apps/deploy/src/main.ts "$@"
