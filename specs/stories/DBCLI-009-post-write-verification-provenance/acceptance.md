# Acceptance Criteria

## Happy Path

* [ ] When requested after an existing registered verification scenario reaches
  authoritative processing, a receipt is atomically written inside the
  workspace with canonical command provenance, matching hash, safe
  audit/artifact references, outcome, observation, and `context-required`
  replay; the underlying result and artifact remain unchanged.

## Business Rules

* [ ] `verified`, `not_verified`, `indeterminate`, and `blocked` remain
  distinguishable from receipt `succeeded`/`failed`; `--no-fail` does not turn a
  failed assertion into verified evidence.
* [ ] Planned task-pack evidence remains `planned`; only an executed final
  assertion or verification produces result evidence.
* [ ] Receipt creation never causes, retries, or authorizes DML, DDL, or the
  verification itself.
* [ ] Receipts accept only the current exact versioned allowlist and bounds.
  Safe logical context names, fingerprints, redacted command provenance,
  bounded observation, and audit/artifact IDs are retained; raw SQL, rows,
  credentials, absolute user paths, raw errors, source bodies, and unknown
  fields are rejected.

## Failure Cases

* [ ] A write-bearing, multi-statement, blacklisted, or otherwise unsafe
  verification query is rejected by the underlying verifier without receipt
  creation.
* [ ] Preflight-only execution cannot create a result receipt; unavailable,
  blocked, or non-authoritative state cannot create a receipt claiming success.
* [ ] Invalid or outside-workspace receipt paths, duplicate outputs, malformed
  provenance, and command-hash mismatch fail closed without partial overwrite
  or unsafe output leakage.

## Regression Requirements

* [ ] Existing assertion, verification scenario, audit, artifact, receipt,
  blacklist, and path-safety contracts remain unchanged.
* [ ] Focused tests cover planned/result separation, status versus outcome,
  receipt ordering/provenance hashing, exact-field validation, output
  immutability, and secret-free failure output.
* [ ] `docs/user/en/index.md`, `docs/user/en/index.html`,
  `docs/user/zh-TW/index.md`, and `docs/user/zh-TW/index.html` consistently
  state that verification never authorizes or runs a write.
* [ ] `make verify` passes.

## Verification Notes

Seed canary raw SQL, credentials, rows, absolute/traversal paths, and raw error
text; assert none appears in receipts or bounded receipt failures. Test the
existing artifact contract as a regression without redefining it. Run focused
verification and receipt tests first, then `make verify` from the repository
root.
