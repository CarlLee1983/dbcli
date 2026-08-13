#!/usr/bin/env bash
set -euo pipefail

if command -v bun >/dev/null 2>&1; then
  bun install -g @carllee1983/dbcli
  exit 0
fi

# npm can fetch the package, but the installed executable runs under Bun
# (`#!/usr/bin/env bun`), so an npm-only machine gets a `dbcli` that cannot start.
if command -v npm >/dev/null 2>&1; then
  npm install -g @carllee1983/dbcli
  echo "Installed via npm, but Bun is not on PATH — dbcli will not run." >&2
  echo "Install Bun first: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

echo "Install Bun first, then run: bun install -g @carllee1983/dbcli" >&2
echo "  curl -fsSL https://bun.sh/install | bash" >&2
exit 1
