#!/usr/bin/env bash
set -euo pipefail

# Start the app and verify the index page is served.
PORT=5000
export PORT
DEBUG=0
export DEBUG
LOG_LEVEL=INFO
export LOG_LEVEL

python3 "download copy/app.py" &
PID=$!
trap "kill $PID 2>/dev/null || true" EXIT

for i in {1..10}; do
  if curl -s "http://127.0.0.1:$PORT/" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:$PORT/" -o /tmp/ci_index.html
if ! grep -q "IIIF Proxy Server" /tmp/ci_index.html; then
  echo "Index page missing" >&2
  exit 2
fi

echo "Smoke test passed: index page served"
