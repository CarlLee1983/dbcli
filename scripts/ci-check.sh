#!/bin/sh
# Run from the repository root. CI and release checks share this ordered list.
set -f
started=$(bun run scripts/write-attestation.ts begin) || started=''
count=0
status=0
for step in \
  'bun install --frozen-lockfile' \
  'bun run services:check' \
  'bun run audit' \
  'bun run format:check' \
  'bun run agent-core:check' \
  'bun run core-stdout:check' \
  'bun run typecheck' \
  'bun run typecheck:tests' \
  'bun run lint' \
  'SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test' \
  'bun run build:determinism' \
  'bun run dev -- --help' \
  'bun run dev -- --version' \
  './dist/cli.mjs --help' \
  './dist/cli.mjs --version' \
  'bun run test:perf' \
  'bun run platform:check' \
  'bun run plugin:check' \
  'bun run manifest:check' \
  'bun run docs:check' \
  'bun run contract:check' \
  'bun run plan:check'
do
  count=$((count + 1))
  at=$(date +%s)
  printf '==> [%s] %s\n' "$count" "$step"
  sh -c "$step"
  status=$?
  printf '<== [%s] %s %ss exit %s\n' "$count" "$step" "$(($(date +%s) - at))" "$status"
  [ "$status" -eq 0 ] || break
done

# begin emits three fields (revision, worktree state and timestamp).
bun run scripts/write-attestation.ts finish "$status" $started "$step" || true
exit "$status"
