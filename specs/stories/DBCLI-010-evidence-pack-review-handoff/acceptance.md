# Acceptance Criteria

## Happy Path

* [ ] `evidence compose` accepts valid externally supplied claims and unique
  selected safe references, then atomically writes a canonical pack inside the
  workspace with content-derived ID and SHA-256 integrity.
* [ ] `evidence validate` recognizes a current valid pack, verifies its digest
  and ID, checks source-reference availability, and reports current-valid
  content separately from expired references.
* [ ] `evidence render` renders a valid current pack without rereading its
  original references, including after those sources have expired.

## Business Rules

* [ ] Every claim is visibly labeled as an external claim, never a dbcli
  verification verdict; composition, validation, and rendering never decide
  claim truth or authorize/execute a database operation.
* [ ] Pack content accepts only the exact verification-artifact, audit, and
  receipt reference field variants defined by the Story. It retains their safe
  logical identity/status/path fields while excluding raw SQL/targets,
  verification summaries, credentials, rows, absolute user paths, raw errors,
  unknown fields, and source-evidence bodies.
* [ ] Duplicate references, unsafe claim text, and verification-subject-kind
  mismatches are rejected before output creation.
* [ ] Current source-expired packs return their distinct nonzero status while
  retaining current-content integrity and historical renderability.
* [ ] Legacy and unsupported packs remain non-current-valid; no migration or
  rewrite path is offered.

## Failure Cases

* [ ] Missing, malformed, duplicate, unsafe, or subject-mismatched inputs fail
  with bounded output and leave no new pack.
* [ ] Outside-workspace, symlink-escaping, and existing output targets fail
  without overwriting a file.
* [ ] Bad digest/derived ID, unknown version, and version-structure mismatch
  produce the appropriate bounded classification and nonzero result.

## Regression Requirements

* [ ] Existing evidence-pack, receipt, verification-artifact, audit, blacklist,
  canonicalization, and workspace-path tests remain green.
* [ ] Focused tests cover canonical ordering/identity, source-expiry versus
  integrity, render-without-source, legacy/unsupported handling, no-copy
  boundaries, and no truth/authorization behavior.
* [ ] `docs/user/en/index.md`, `docs/user/en/index.html`,
  `docs/user/zh-TW/index.md`, and `docs/user/zh-TW/index.html` consistently
  describe packs as reference indexes for review/handoff, not truth verdicts.
* [ ] `make verify` passes.

## Verification Notes

Use canary raw SQL/targets, credentials, absolute/traversal paths, raw errors,
and source bodies in fixtures; assert they never enter a pack, render, or
failure. Run focused evidence-pack tests first, then `make verify` from the
repository root.
