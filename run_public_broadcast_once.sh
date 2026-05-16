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
export PUBLIC_BROADCAST=1
export TARGET_LOCATION="${TARGET_LOCATION:-Botany}"
export STATUS_JSON_PATH="${STATUS_JSON_PATH:-docs/status.json}"
export STATE_PATH="${STATE_PATH:-state/public_broadcast_state.json}"

NODE_BIN="${NODE_BIN:-/Users/owenmac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
"$NODE_BIN" watch_nsw_slots.js --once
