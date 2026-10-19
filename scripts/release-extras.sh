#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Post-build checks only. Refuse missing artifacts before the smoke suite's
# development build helper can silently repair an incomplete release build.
for artifact in dist/cli.mjs dist/cli-runtime.mjs dist/core.mjs dist/core.d.ts \
  dist/agent-core.mjs dist/agent-core.d.ts dist/ui-style.css assets/ui-template.html; do
  if [ ! -f "$artifact" ]; then
    echo "Missing release artifact: $artifact; build the verified candidate first" >&2
    exit 1
  fi
done

bun test tests/integration/dist-smoke.test.ts

PKG_VERSION=$(bun -p "require('./package.json').version")
if ! grep -qE '^\| `audit` ' docs/feature-matrix.md; then
  echo "docs/feature-matrix.md missing 'audit' row" >&2
  exit 1
fi
if ! grep -qF "## [${PKG_VERSION}]" CHANGELOG.md; then
  echo "CHANGELOG.md missing '## [${PKG_VERSION}]' heading" >&2
  exit 1
fi

printf '\n\033[1;32m✓ release:extras passed\033[0m\n'
