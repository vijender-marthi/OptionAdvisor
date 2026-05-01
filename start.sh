#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting OptionAdvisor..."
echo "Backend:  http://127.0.0.1:9000"
echo "Frontend: http://localhost:4200"
echo

"$ROOT_DIR/backend/start.sh" &
BACKEND_PID=$!

"$ROOT_DIR/frontend/start.sh" &
FRONTEND_PID=$!

cleanup() {
  echo
  echo "Stopping OptionAdvisor..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    wait "$BACKEND_PID" || true
    exit 1
  fi

  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    wait "$FRONTEND_PID" || true
    exit 1
  fi

  sleep 1
done
