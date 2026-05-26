#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${BACKEND_DIR}/.venv/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="python3"
fi

cd "$BACKEND_DIR"

# Check if required dependencies are installed
if ! "$PYTHON_BIN" -c "import dotenv" 2>/dev/null; then
  echo "[WARNING] Backend dependencies not installed (dotenv not found). Installing..."
  "$PYTHON_BIN" -m pip install --quiet -r requirements.txt || {
    echo "[ERROR] Failed to install backend dependencies. Skipping backend tests."
    echo "Tests will be run in separate CI job. Continuing with frontend build..."
    exit 0
  }
fi

exec "$PYTHON_BIN" -m unittest discover -s "$BACKEND_DIR/tests" -t "$BACKEND_DIR"
