#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/coder/wave-orchestration"
BASE="$ROOT/.codex-tools/railway-mcp"
SERVER_ENTRY="$BASE/node_modules/@railway/mcp-server/dist/index.js"
LOCAL_BIN="$BASE/node_modules/.bin"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "Railway MCP launcher error: missing Node runtime at $NODE_BIN" >&2
  exit 1
fi

if [ ! -f "$SERVER_ENTRY" ]; then
  echo "Railway MCP launcher error: missing MCP server entrypoint at $SERVER_ENTRY" >&2
  exit 1
fi

export PATH="$LOCAL_BIN:/home/coder/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

exec "$NODE_BIN" "$SERVER_ENTRY"
