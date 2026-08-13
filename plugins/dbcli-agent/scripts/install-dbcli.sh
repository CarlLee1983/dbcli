#!/usr/bin/env bash
set -euo pipefail

if command -v bun >/dev/null 2>&1; then
  bun install -g @carllee1983/dbcli
  exit 0
fi

# npm can fetch the package, but the installed executable runs under Bun
# (`#!/usr/bin/env bun`), so installing it here would leave a `dbcli` on PATH that
# cannot start. Refuse instead of half-installing.
echo "Bun is required: dbcli's executable runs under Bun, whichever package manager installs it." >&2
echo "Install Bun, then re-run this script:" >&2
echo "  curl -fsSL https://bun.sh/install | bash" >&2
exit 1
