#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step '1/9 bun audit'
bun audit

# Via `bun run` so the glob lives in one place (package.json) and CI's `format`
# job checks exactly what this checks — the two drifting apart is how unformatted
# files reached main in the first place.
step '2/9 prettier --check'
bun run format:check

step '3/9 agent-core purity'
bun run agent-core:check

step '4/9 typecheck'
bun run typecheck

step '5/9 lint'
bun run lint

step '6/9 test'
bun test

step '7/9 build'
bun run build

step '8/9 dist smoke'
bun test tests/integration/dist-smoke.test.ts

step '9/9 doc & manifest presence'
bun run skill:check
bun run platform:check
bun run plugin:check
bun run manifest:check
bun run docs:check
bun run contract:check
PKG_VERSION=$(bun -p "require('./package.json').version")
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
