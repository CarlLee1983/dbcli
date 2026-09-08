.PHONY: verify

# Verification must describe a checkout, not a machine. CI installs before every
# job, so `make verify` on its own assumed dependencies someone else had already
# put there: a fresh checkout got `prettier: command not found` and a `tsc`
# resolved from PATH. `--frozen-lockfile` fails rather than resolving a set that
# `bun.lock` does not pin.
#
# The steps run inside one subshell so that a FAIL is recorded too. `make` stops
# at the first failing step, so an attestation written as a final line would only
# ever describe a passing run — the case nobody needs evidence for. The subshell
# captures the status, the attestation is written either way, and the recipe
# re-exits with the captured status: writing a record never changes a verdict.
# DBCLI-017, and `scripts/write-attestation.ts` for what the record says.
verify:
	@bun run scripts/write-attestation.ts begin
	@set -o pipefail; ( \
		bun install --frozen-lockfile && \
		bun run services:check && \
		bun run audit && \
		bun run format:check && \
		bun run agent-core:check && \
		bun run core-stdout:check && \
		bun run typecheck && \
		bun run typecheck:tests && \
		bun run lint && \
		SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test && \
		bun run build && \
		bun run build:determinism && \
		bun run dev -- --help && \
		bun run dev -- --version && \
		./dist/cli.mjs --help && \
		./dist/cli.mjs --version && \
		bun run test:perf && \
		bun run platform:check && \
		bun run plugin:check && \
		bun run manifest:check && \
		bun run docs:check && \
		bun run contract:check && \
		bun run plan:check && \
		bun run forgeflow:check \
	); status=$$?; \
	bun run scripts/write-attestation.ts finish $$status; \
	exit $$status
