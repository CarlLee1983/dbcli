#!/usr/bin/env bash
set -euo pipefail

if command -v bun >/dev/null 2>&1; then
  bun install -g @carllee1983/dbcli
  exit 0
fi

if command -v npm >/dev/null 2>&1; then
  npm install -g @carllee1983/dbcli
  exit 0
fi

echo "Install Bun or npm first, then run: bun install -g @carllee1983/dbcli" >&2
exit 1
