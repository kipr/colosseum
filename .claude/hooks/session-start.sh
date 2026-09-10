#!/bin/bash
# Starts the services a Claude Code on the web session needs. The cloud
# environment's setup script installs Node 24, npm dependencies and the
# Playwright browser, but anything it leaves running dies when it exits, and
# it does not run again when a session resumes.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# The image puts Node 22 first on PATH; the repo requires Node 24.
node24=/opt/node24/bin
if [ -x "$node24/node" ]; then
  export PATH="$node24:$PATH"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export PATH=\"$node24:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  fi
fi

cd "$CLAUDE_PROJECT_DIR"
[ -f .env ] || cp .env.example .env

# Hook stdout becomes session context, so command output goes to stderr.
if ! docker info >/dev/null 2>&1; then
  # mirror.gcr.io avoids Docker Hub's anonymous pull rate limit.
  setsid dockerd --registry-mirror=https://mirror.gcr.io \
    </dev/null >/var/log/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi

npm run db:up >&2
npm run db:wait >&2
