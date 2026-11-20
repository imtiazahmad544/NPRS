#!/usr/bin/env bash
# Start the NPRS core service (API + web app) on http://localhost:8000
set -e
cd "$(dirname "$0")"
export PYTHONPATH="backend${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port "${PORT:-8000}"
