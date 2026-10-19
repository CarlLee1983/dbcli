#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Canonical checks live in one place. To reuse a PASS for this exact candidate
# and valid environment, build and run release:extras instead of this wrapper.
make verify
bun run release:extras

printf '\n\033[1;32m✓ release:check passed\033[0m\n'
