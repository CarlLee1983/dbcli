#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step '1/7 bun audit'
bun audit

step '2/7 prettier --check'
bunx prettier --check "src/**/*.ts" "tests/**/*.ts"

step '3/7 typecheck'
bun run typecheck

step '4/7 lint'
bun run lint

step '5/7 test'
bun test

step '6/7 build'
bun run build

step '7/7 dist smoke'
bun test tests/integration/dist-smoke.test.ts

printf '\n\033[1;32m✓ release:check passed\033[0m\n'
