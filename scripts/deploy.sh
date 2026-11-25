#!/usr/bin/env bash
set -Eeuo pipefail

# The checkout this script lives in (whatever the folder is called).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="master"
LOCK_FILE="/run/homesite-deploy.lock"

exec 9>"$LOCK_FILE"

if ! flock -n 9; then
  echo "A HomeSite deployment is already running; skipping this delivery." >&2
  exit 75
fi

cd "$REPO_DIR"

echo "Fetching origin/${BRANCH}..."
git fetch --prune origin "$BRANCH"

echo "Resetting to origin/${BRANCH}..."
git reset --hard "origin/${BRANCH}"

echo "Installing locked dependencies..."
pnpm install --frozen-lockfile

echo "Running project checks..."
pnpm checks

echo "Building Vite production files..."
pnpm run build

test -f "${REPO_DIR}/dist/index.html"

echo "Restarting application services..."
/usr/bin/systemctl restart \
  homesite.service \
  accounts-api.service \
  discord-bot.service \
  discord-profile.service

# The API gateway (server/gateway.cjs, API_ORIGIN), where it's set up as a unit.
if /usr/bin/systemctl cat homesite-gateway.service >/dev/null 2>&1; then
  /usr/bin/systemctl restart homesite-gateway.service
fi

echo "HomeSite deployment completed successfully."
