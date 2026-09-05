# Story: DBCLI-PLAT-007 Bounded Evidence Receipts

## Approval State

Approved — implementation authorized by the user on 2026-09-05.

## Goal

An external agent can persist a bounded, safe evidence receipt for `inspect`,
`report`, `schema`, `plan`, `lint`, `explain`, and `impact`, without exposing
operation input, database data, credentials, filesystem paths, or raw failures.

## Context

dbcli already writes versioned evidence receipts for `assert` and `verify`.
Those receipts provide the shared persistence, validation, atomic-write, and
read-back contract. This Story extends that contract to seven existing command
paths; it must not create a parallel evidence format or writer.

## Classification

* Security sensitive: yes
* Baseline conformance: no

## Scope

### In Scope

* An optional `--evidence-receipt <path>` for each target command.
* A versioned receipt operation for each target command, containing only bounded
  operation metadata, digests, safe context, subject, timestamp, capability,
  and the optional correlation reference already governed by PLAT-006.
* Reusing the existing evidence-receipt parser and atomic writer.
* Updating the derived evidence-command capability surface.
* Tests for each command, all forbidden content classes, and receipt-write
  failure preserving the command's authoritative result.

### Out of Scope

* New evidence formats, a second writer, raw result persistence, or replay.
* Changes to command success/failure decisions, permission, blacklist,
  redaction, audit, or write gates.
* Receipts for commands other than `inspect`, `report`, `schema`, `plan`,
  `lint`, `explain`, and `impact`.
* Task Pack capability validation (PLAT-008), the Skill author kit (PLAT-009),
  or external consumer fixtures (PLAT-010).

## Inputs

* The existing input and output options of a target command.
* An optional workspace-relative `--evidence-receipt <path>`.
* An optional valid root `--correlation-id <id>`.

## Outputs

On a successful receipt write, the command reports its receipt path through its
existing output channel. On a receipt-write failure, it reports the stable string
`Failed to write evidence receipt`; the original command outcome and exit code
remain authoritative.

## Rules

* R1: A receipt contains only safe, bounded metadata and hashes. It never stores
  raw rows, credentials, connection strings, unmasked SQL, raw errors, session
  secrets, absolute paths, or unbounded stdout/stderr.
* R2: Each target command maps to one explicit receipt operation and its
  capability ID; unknown operations or receipt fields fail closed during parsing.
* R3: Receipt writes use the existing workspace-confined atomic writer. An
  existing file, escaping path, symlink escape, validation failure, or I/O
  failure produces the stable receipt error without replacing the operation's
  authoritative outcome.
* R4: A valid correlation ID may appear only as the existing bounded correlation
  reference. Its absence leaves the receipt field absent or null according to
  the versioned receipt contract.
* R5: The existing receipt parser continues to accept historical `assert` and
  `verify` receipts unchanged.
* R6: `COMMAND_SURFACE.evidenceCommands` remains derived from real writer call
  sites and includes every command that can write a receipt after this Story.

## Expected Errors

* An invalid, existing, escaping, or symlinked receipt path reports `Failed to
  write evidence receipt` without raw error details and does not alter the
  command's result or exit code.
* A malformed receipt, unknown receipt operation, unknown receipt field, or
  unsafe persisted value is rejected before persistence.

## Dependencies

* `src/core/evidence-receipt/` — versioned receipt contract and atomic writer.
* `src/commands/evidence-receipt-context.ts` — safe deterministic context.
* Target command implementations and `src/core/capabilities/registry.ts`.

## Constraints

* No new production dependency.
* Core remains pure: it does not write stdout or stderr.
* Receipt persistence is optional and cannot grant command capability or mask an
  original failure.
* `make verify` must pass.

## Trust Boundary Fields

* `--evidence-receipt <path>` — caller-controlled path; must remain within the
  real workspace and must not overwrite an existing file.
* Command inputs and outputs — may contain SQL, rows, paths, errors, or secrets;
  none may enter a receipt.
* `--correlation-id` — caller-controlled but already grammar-validated opaque ID;
  it is the only caller value permitted as a correlation reference.
* Receipt JSON — persisted and externally consumed; parse strictly and reject
  unknown fields and unsafe content.
