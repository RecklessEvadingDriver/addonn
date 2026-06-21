#!/usr/bin/env sh
set -eu

# Start the addon in Termux and listen on all Android network interfaces.
# Override PORT if needed, for example: PORT=8080 ./scripts/start-termux.sh
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-7000}"

cd "$(dirname "$0")/.."
exec node src/index.js
