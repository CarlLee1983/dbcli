.PHONY: verify

# Verification must describe a checkout, not a machine. CI installs before every
# job, so `make verify` on its own assumed dependencies someone else had already
# put there: a fresh checkout got `prettier: command not found` and a `tsc`
# resolved from PATH. `--frozen-lockfile` fails rather than resolving a set that
# `bun.lock` does not pin.
#
# The steps are one recipe line so that a FAIL is recorded too. `make` stops at
# the first failing *line*, so an attestation written as a final line would only
# ever describe a passing run — the case nobody needs evidence for. Joined by
# `&&`, the chain stops at the first failure, `status=$$?` captures it, the
# attestation is written either way, and the recipe re-exits with that status.
#
# DBCLI-030 removed the parentheses that used to group the chain. They never
# made it stop — `&&` does — but they made it a subshell, and `step` died with
# it, so every FAIL attestation could say only that something failed. Each step
# now names itself first, and the name that survives is the step the run stopped
# at. Nothing crosses `begin` and `finish` through a file, which is DBCLI-017's
# rule and the reason this is a variable rather than a marker file.
#
# The recipe stays POSIX. GNU Make ignores the environment's `SHELL` and runs
# `/bin/sh`, which is dash on the Ubuntu runner this gate's `integration` job
# uses — and dash has no `pipefail`. An earlier version set it, which aborted
# the recipe line before the subshell was entered: zero of the 24 steps ran, no
# attestation was written, and the failure looked like a verification failure.
# It passed locally only because macOS `/bin/sh` is bash. Nothing here pipes
# anything, so `pipefail` was a fatal no-op.
#
# One thing was lost and is only half recovered: each step used to be its own
# recipe line, so make echoed it and a CI log showed which of the checks was
# running and which one failed. Joined and prefixed with `@`, it does not.
# DBCLI-030 recovered the half that matters after the fact — the attestation
# names the failing step — and left the half that matters during the run, a live
# log saying which step is executing and how long it took. That still means
# echoing each step with its own timing, and it is recorded here rather than
# rediscovered.
#
# Neither attestation phase can decide the verdict, which is the point of the
# `|| run=''` and the `|| true`: `begin` failing leaves `run` empty so `finish`
# refuses and says so, and neither failure is allowed to stand between a
# developer and their verification result. The two phases hand the revision
# along this one shell rather than through a file, so a run killed halfway
# cannot leave state for the next run to pick up and describe as its own.
# DBCLI-017, and `scripts/write-attestation.ts` for what the record says.
verify:
	@run=$$(bun run scripts/write-attestation.ts begin) || run=''; \
	step='bun install --frozen-lockfile' && bun install --frozen-lockfile && \
	step='bun run services:check' && bun run services:check && \
	step='bun run audit' && bun run audit && \
	step='bun run format:check' && bun run format:check && \
	step='bun run agent-core:check' && bun run agent-core:check && \
	step='bun run core-stdout:check' && bun run core-stdout:check && \
	step='bun run typecheck' && bun run typecheck && \
	step='bun run typecheck:tests' && bun run typecheck:tests && \
	step='bun run lint' && bun run lint && \
	step='SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test' && SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test && \
	step='bun run build' && bun run build && \
	step='bun run build:determinism' && bun run build:determinism && \
	step='bun run dev -- --help' && bun run dev -- --help && \
	step='bun run dev -- --version' && bun run dev -- --version && \
	step='./dist/cli.mjs --help' && ./dist/cli.mjs --help && \
	step='./dist/cli.mjs --version' && ./dist/cli.mjs --version && \
	step='bun run test:perf' && bun run test:perf && \
	step='bun run platform:check' && bun run platform:check && \
	step='bun run plugin:check' && bun run plugin:check && \
	step='bun run manifest:check' && bun run manifest:check && \
	step='bun run docs:check' && bun run docs:check && \
	step='bun run contract:check' && bun run contract:check && \
	step='bun run plan:check' && bun run plan:check && \
	step='bun run forgeflow:check' && bun run forgeflow:check; \
	status=$$?; \
	bun run scripts/write-attestation.ts finish $$status $$run "$$step" || true; \
	exit $$status
