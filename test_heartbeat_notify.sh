#!/bin/zsh
set -euo pipefail

export NODE_PATH="/Users/owenmac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"

/Users/owenmac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node watch_nsw_slots.js --test-heartbeat
