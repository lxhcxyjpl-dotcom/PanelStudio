#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PORT=3001
if [[ -z "${DATA_DIR:-}" ]]; then
  DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/panelstudio-e2e.XXXXXX")"
  export DATA_DIR
fi
pnpm --filter @panelstudio/server exec node start.mjs &
server_pid=$!
cleanup() { kill "$server_pid" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 100); do
  if curl -sf "http://127.0.0.1:3001/api/v1/health" >/dev/null; then
    break
  fi
  sleep 0.2
done
curl -sf "http://127.0.0.1:3001/api/v1/health" >/dev/null
export PANELSTUDIO_API="http://127.0.0.1:3001"
pnpm --filter @panelstudio/web dev -- --host 127.0.0.1 --port 5173 --strictPort
