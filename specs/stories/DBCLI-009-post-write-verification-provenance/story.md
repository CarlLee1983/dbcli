# Story: DBCLI-009 Post-Write Verification Provenance

## Goal

After an independently authorized write, let an operator run the existing
read-only verifier and optionally retain a secret-free provenance receipt; the
receipt step itself must not execute, retry, or authorize the write or
verification.

## Context

Planning evidence describes a future check; result evidence records an executed
read-back outcome. Those are distinct. Verification may inspect an already
changed database state, but its command surface must never perform DML or DDL.
A receipt links the authoritative verdict, audit attempt, and optional artifact
without copying SQL, rows, credentials, or user paths.

The repository already exposes generic verification receipts. This
baseline-conformance Story formalizes the published Pages contract: execution
begins by verifying current behavior and changes code only where an acceptance
criterion fails.

## Scope

### In Scope

* Attach an optional workspace-contained provenance receipt after an existing
  registered verification scenario has produced an authoritative result.
* Record canonical command provenance, command hash, audit/artifact references,
  result outcome, and context-required replay status.
* Preserve planned-versus-result evidence semantics and document them in both
  user-guide languages and formats.

### Out of Scope

* Executing, retrying, approving, rolling back, or generating a write/DDL
  command.
* Treating a planned task-pack verification block, a receipt, or a successful
  assertion as approval for a write.
* Changing or persisting the underlying verification artifact; the receipt may
  contain only its bounded identifier reference.
* Storing raw SQL, result rows, credentials, absolute user paths, raw driver
  errors, or source artifact bodies in a receipt.
* Redefining the safe-backfill guards, statuses, or artifact contract owned by
  DBCLI-005.

## Inputs

* An existing authoritative verification verdict, audit attempt reference,
  optional persisted verification-artifact reference, and receipt output path.

## Outputs

* The existing classified verification result, unchanged.
* An optional atomic, workspace-contained provenance receipt using the current
  versioned allowlist: identity/time, operation/outcome, bounded
  engine/connection/environment and schema/semantic fingerprints, canonical
  redacted command/hash and nullable audit/artifact references,
  `context-required` replay, and bounded verification observation.

## Rules

* R1: Receipt creation runs only after the existing read-only verification path;
  it never causes, retries, or authorizes DML, DDL, or verification execution.
* R2: Planned evidence remains `planned` and is never represented as a result;
  result evidence records only an executed verification outcome.
* R3: Receipt creation occurs only after the verdict, audit attempt, and
  optional artifact state are authoritative. Preflight-only paths cannot write
  a result receipt.
* R4: Receipt outcome (`succeeded` or `failed`) remains distinct from
  verification status.
* R5: Receipt provenance contains a canonicalized command and matching hash,
  nullable safe references, and `context-required` replay only.
* R6: Receipt writes are atomic, never overwrite existing files, and remain
  within the workspace/defined storage boundary.
* R7: Unsafe verification queries, blacklisted subjects, schema/plan guard
  failures, and incomplete authoritative state are handled by the underlying
  verifier; no receipt is created for a preflight/non-authoritative result or
  claims a successful result when authoritative processing failed.
* R8: Receipt parsing accepts only the current exact versioned field allowlist
  and existing bounds. Safe logical context names, fingerprints, redacted
  command provenance, and bounded reference IDs are allowed; raw source bodies
  and unlisted fields are not.

## Expected Errors

* A write-bearing, multi-statement, or otherwise unsafe verification query is
  rejected by the underlying verifier without creating a receipt.
* Receipt path traversal, existing output, invalid provenance, or hash mismatch
  fails without overwriting an artifact or leaking unsafe evidence.
* An unavailable or failed post-write check reports its bounded classified state
  and cannot be upgraded by `--no-fail`, a plan, or a receipt.

## Dependencies

* Existing verification scenario/assertion, audit, artifact writer, evidence
  receipt, blacklist, schema/plan guard, and workspace-path boundaries,
  including safe-backfill verification when that scenario is used.

## Constraints

* Verification never authorizes or runs a write.
* Do not add dependencies or persist raw query/data/credential material.
* Keep `docs/user/en/index.md`, `docs/user/en/index.html`,
  `docs/user/zh-TW/index.md`, and `docs/user/zh-TW/index.html` aligned.
* Use `make verify` as the completion gate.
