#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
  echo "Creating backend virtual environment..."
  python3 -m venv .venv
fi

source ".venv/bin/activate"

if [ -f "requirements.txt" ]; then
  echo "Installing backend dependencies..."
  pip install -r requirements.txt
fi

if [ ! -f ".env" ]; then
  echo "No backend/.env found. Copy backend/.env.example or create backend/.env if you need SMTP or custom DB settings."
fi

echo "Starting FastAPI backend on http://127.0.0.1:9000"
exec uvicorn main:app --host 127.0.0.1 --port 9000 --reload
