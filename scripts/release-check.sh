#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step '1/8 bun audit'
bun audit

step '2/8 prettier --check'
bunx prettier --check "src/**/*.ts" "tests/**/*.ts" "scripts/**/*.ts"

step '3/8 typecheck'
bun run typecheck

step '4/8 lint'
bun run lint

step '5/8 test'
bun test

step '6/8 build'
bun run build

step '7/8 dist smoke'
bun test tests/integration/dist-smoke.test.ts

step '8/8 doc-presence'
bun run skill:check
bun run platform:check
bun run plugin:check
bun run docs:check
PKG_VERSION=$(node -p "require('./package.json').version")
if ! grep -qE '^\| `audit` ' docs/feature-matrix.md; then
  echo "  ✗ docs/feature-matrix.md missing 'audit' row" >&2
  exit 1
fi
if ! grep -qF "## [${PKG_VERSION}]" CHANGELOG.md; then
  echo "  ✗ CHANGELOG.md missing '## [${PKG_VERSION}]' heading" >&2
  exit 1
fi
echo "  ✓ feature-matrix has audit row"
echo "  ✓ CHANGELOG.md has ## [${PKG_VERSION}] heading"

printf '\n\033[1;32m✓ release:check passed\033[0m\n'
