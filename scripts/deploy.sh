#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="/opt/homesite-api"
BRANCH="master"
LOCK_FILE="/run/homesite-api-deploy.lock"

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

echo "Restarting HomeSite service..."
/usr/bin/systemctl restart homesite.service

echo "HomeSite deployment completed successfully."
