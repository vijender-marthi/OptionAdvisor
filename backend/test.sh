#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${BACKEND_DIR}/.venv/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

cd "$BACKEND_DIR"
exec "$PYTHON_BIN" -m unittest discover -s "$BACKEND_DIR/tests" -t "$BACKEND_DIR"
