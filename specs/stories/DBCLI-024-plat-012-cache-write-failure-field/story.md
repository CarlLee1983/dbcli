# Story: DBCLI-024 The Cache-Write Failure Row Names What It Means

## Goal

DBCLI-PLAT-012's last two prose cells state exact values, and its trust-boundary
bullet stops understating a guarantee the code already gives.

## Context

Two of PLAT-012's three findings are one matrix row. Row 10 reads:

    | cache-write failure message | "EACCES: permission denied, open
      '/Users/someone/.config/dbcli/config.json'" | redact | stderr, audit entry |

Both the source field and the persisted locations are prose. Re-deriving them
found the row describing something weaker than what happens.

**The raw message never survives.** `reportingCacheWriteFailure` catches whatever
`persistSchemaCache` throws and never reads its `.message`; `cacheWriteReason`
classifies the error instead of quoting it. A `SchemaCacheWriteError` contributes
its own message, path-free by that module's construction; a `ConfigError` gets a
fixed sentence; every other cause — every `EACCES`, `ENOSPC`, every fs error that
could carry a path — is replaced wholesale by
`The local schema cache could not be written.` The redaction utilities never see
the payload, because it was discarded upstream of them.

So the persisted locations are `none`, which is also what PLAT-004's own `redact`
row uses for a payload that reaches nothing. `stderr, audit entry` described
where the *replacement* goes, not where the payload goes, and the column asks for
the latter.

Investigating the audit half separately was worth it and produced no change
here. The classified string does reach the audit entry — as the top-level
`error` field, not anything under `metadata` — but only when audit is enabled,
and the fixture the row cites disables it. None of that belongs in this cell:
the column tracks the payload, and the payload reaches neither.

The trust-boundary bullet had the same understatement, saying the message is
"derived from a caught error, which may carry a filesystem path from the
runtime". It may not. That is the guarantee, and the bullet was describing the
risk instead of the guard.

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: mixed

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: low

## Risk

* Level: medium
* Reason: `security-declaration`

A fixture row is a security claim. Restating one to satisfy a checker while
saying less than it did is the failure this Story is guarding against, and the
old row already said less than the code guarantees.

## Scope

### In Scope

* Row 10's source field becoming `error.message` and its persisted locations
  becoming `none`.
* Rewriting the `## Trust Boundary Fields` bullet for that value to state the
  discard-and-replace guarantee, naming `cacheWriteReason` and the fixed string.
* Deleting PLAT-012's entry from `PREDATING_FINDINGS`.

### Out of Scope

* Row 10's expected result. `redact` stays: the field is present with a safe
  value rather than absent, which is what distinguishes it from `omit`, and
  upstream's closed set has no better member. Changing it would change the
  security requirement, not describe it.
* Adding an audit-enabled test. The cell tracks the payload, and the payload is
  persisted nowhere; the audit-entry observation is recorded here rather than
  turned into a test this row does not need.
* Any change to `src/`.

## Inputs

* `src/commands/schema.ts` — `reportingCacheWriteFailure` and `cacheWriteReason`.
* `src/core/schema-cache-persistence.ts` — `SchemaCacheWriteError`.
* `tests/integration/schema-cache-agent-mode.test.ts` — the cited fixture.

## Outputs

* A PLAT-012 Story upstream `story-check` reports no finding against.

## Rules

* R1: The source field names where the payload enters, and the persisted
  locations name where the payload ends up — not where its replacement goes.
* R2: The trust-boundary bullet states the guarantee, not the risk it removes.
* R3: The expected result is unchanged.
* R4: No other exemption is added, removed, renamed or broadened.

## Expected Errors

* A cell left as prose keeps the upstream finding, and the gate then fails on
  the deleted exemption as unadmitted.

## Dependencies

* `scripts/lib/forgeflow-contract.ts` — the exemption list and its counts.

## Constraints

* `bun run forgeflow:contract` is not in `make verify`; both must pass.
