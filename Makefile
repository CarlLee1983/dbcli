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
# What joining the steps cost is now paid in full. Each step used to be its own
# recipe line, so make echoed it and a log showed which check was running and
# which one failed; joined and prefixed with `@`, it did not. DBCLI-030 recovered
# the half read afterwards — the attestation names the failing step — and
# DBCLI-031 the half read during: `run` prints each step's number and name before
# it runs and its elapsed seconds and status after.
#
# `run` executes `eval "$$step"`, so a step's label and its command are one
# string rather than two copies that can disagree. The input is the single-quoted
# literal on the line above, pinned character-for-character by
# `tests/contract/forgepilot-boundary.test.ts`, which also refuses a `;` anywhere
# in a step. ADR-0034.
#
# Neither attestation phase can decide the verdict, which is the point of the
# `|| run=''` and the `|| true`: `begin` failing leaves `run` empty so `finish`
# refuses and says so, and neither failure is allowed to stand between a
# developer and their verification result. The two phases hand the revision
# along this one shell rather than through a file, so a run killed halfway
# cannot leave state for the next run to pick up and describe as its own.
# DBCLI-017, and `scripts/write-attestation.ts` for what the record says.
verify:
	@started=$$(bun run scripts/write-attestation.ts begin) || started=''; \
	run() { count=$$((count+1)); at=$$(date +%s); \
		printf '==> [%s] %s\n' "$$count" "$$step"; \
		eval "$$step"; code=$$?; \
		printf '<== [%s] %s %ss exit %s\n' "$$count" "$$step" "$$(($$(date +%s)-at))" "$$code"; \
		return $$code; }; \
	step='bun install --frozen-lockfile' && run && \
	step='bun run services:check' && run && \
	step='bun run audit' && run && \
	step='bun run format:check' && run && \
	step='bun run agent-core:check' && run && \
	step='bun run core-stdout:check' && run && \
	step='bun run typecheck' && run && \
	step='bun run typecheck:tests' && run && \
	step='bun run lint' && run && \
	step='SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test' && run && \
	step='bun run build:determinism' && run && \
	step='bun run dev -- --help' && run && \
	step='bun run dev -- --version' && run && \
	step='./dist/cli.mjs --help' && run && \
	step='./dist/cli.mjs --version' && run && \
	step='bun run test:perf' && run && \
	step='bun run platform:check' && run && \
	step='bun run plugin:check' && run && \
	step='bun run manifest:check' && run && \
	step='bun run docs:check' && run && \
	step='bun run contract:check' && run && \
	step='bun run plan:check' && run && \
	step='bun run forgeflow:check' && run; \
	status=$$?; \
	bun run scripts/write-attestation.ts finish $$status $$started "$$step" || true; \
	exit $$status
