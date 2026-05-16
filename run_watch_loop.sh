#!/bin/zsh
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${BOOKING_NUMBER:?BOOKING_NUMBER must be set (use .env or export it)}"
: "${FAMILY_NAME:?FAMILY_NAME must be set (use .env or export it)}"

export NODE_PATH="${NODE_PATH:-/Users/owenmac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules}"
export INTERVAL_MINUTES_MIN="${INTERVAL_MINUTES_MIN:-25}"
export INTERVAL_MINUTES_MAX="${INTERVAL_MINUTES_MAX:-35}"
export HEARTBEAT_NOTIFY="${HEARTBEAT_NOTIFY:-1}"

NODE_BIN="${NODE_BIN:-/Users/owenmac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
"$NODE_BIN" watch_nsw_slots.js
