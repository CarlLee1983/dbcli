#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Canonical checks live in one place. After ForgePilot verified this exact
# candidate, run release:extras directly instead of this full wrapper.
make verify
bun run release:extras

printf '\n\033[1;32m✓ release:check passed\033[0m\n'
