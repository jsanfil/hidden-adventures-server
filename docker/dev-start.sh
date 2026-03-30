#!/bin/sh

set -eu

cd /app

DEPS_HASH_FILE="node_modules/.deps-hash"
CURRENT_HASH="$(cat package.json package-lock.json | sha256sum | awk '{print $1}')"
NEEDS_INSTALL=0

if [ ! -d node_modules ]; then
  NEEDS_INSTALL=1
elif [ ! -x node_modules/.bin/tsx ]; then
  NEEDS_INSTALL=1
elif [ ! -f "$DEPS_HASH_FILE" ]; then
  NEEDS_INSTALL=1
elif [ "$(cat "$DEPS_HASH_FILE")" != "$CURRENT_HASH" ]; then
  NEEDS_INSTALL=1
fi

if [ "$NEEDS_INSTALL" -eq 1 ]; then
  echo "Syncing npm dependencies for the Docker dev environment..."
  npm install
  mkdir -p node_modules
  printf '%s\n' "$CURRENT_HASH" > "$DEPS_HASH_FILE"
fi

exec npm run dev
