# Acceptance Criteria

## Happy Path

* [x] Upstream `story-check` at `cb4bc976` reports no `FAIL` line for
      `specs/stories/DBCLI-PLAT-012-schema-cache-write-boundary` —
      `FORGEFLOW_ROOT=<checkout> bun run forgeflow:contract`

## Business Rules

* [x] Row 10's source field is `error.message` and its persisted locations are
      `none`; its payload and expected result `redact` are unchanged — `git diff`
      of that acceptance file against the baseline commit
* [x] `cacheWriteReason` never returns the caught error's own message for an fs
      error: a `SchemaCacheWriteError` returns its own path-free message, a
      `ConfigError` a fixed sentence, and every other cause the fixed string
      `The local schema cache could not be written.` — `src/commands/schema.ts`
* [x] The refusal text names no path, credential or endpoint —
      `tests/integration/schema-cache-agent-mode.test.ts`
* [x] The trust-boundary bullet names `error.message` and states the
      discard-and-replace guarantee — human review of `story.md`

## Failure Cases

* [x] A cell left as prose keeps the upstream finding and the gate fails on the
      deleted exemption as unadmitted —
      `tests/unit/scripts/forgeflow-contract.test.ts`

## Regression Requirements

* [x] `src/` is unchanged by this Story — `git diff --stat` against the baseline
* [x] The complete repository verification gate passes — `make verify`

## Verification Notes

`redact` is kept deliberately: the field is present with a safe value rather
than absent, which is what separates it from `omit`. The audit entry does
receive the classified string, as the top-level `error` field and only when
audit is enabled — recorded here because the cited fixture disables audit, and
not made a test because the column tracks the payload, which reaches nothing.
