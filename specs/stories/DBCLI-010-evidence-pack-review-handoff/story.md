# Story: DBCLI-010 Evidence Pack Review Handoff

## Goal

Produce a canonical, integrity-bound offline index of selected local evidence
references and externally supplied claims so a reviewer can inspect or hand off
context without copying source evidence or having dbcli decide whether a claim
is true.

## Context

An evidence pack is a review/handoff artifact, not a verification verdict or
execution approval. It keeps claims separate from their references, derives its
identity from canonical content, and can remain renderable for historical
review after referenced source evidence expires.

The repository already exposes this workflow. This baseline-conformance Story
formalizes the published Pages contract: execution begins by verifying current
behavior and changes code only where an acceptance criterion fails.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: yes

## Scope

### In Scope

* Compose a new workspace-contained JSON or Markdown evidence pack from a
  claims file and selected local verification-artifact, audit, and receipt
  references.
* Validate format, canonical structure, SHA-256 integrity, identity, and source
  reference availability; render a valid pack without rereading source evidence.
* Classify current-valid, source-expired, recognized legacy, and unsupported
  artifacts without migration or truth adjudication.
* Preserve source-evidence boundaries and aligned English and Traditional
  Chinese user documentation.

### Out of Scope

* Connecting to a database, executing SQL, running verification, or authorizing
  a write.
* Copying raw SQL, raw targets, verification summaries, credentials, rows,
  absolute user paths, raw errors, or source-evidence bodies into a pack.
* Determining whether a claim is true, upgrading claim status to a verdict, or
  migrating legacy packs.

## Inputs

* A claims JSON file with exactly a subject and plain-language claims.
* One or more selected existing verification-artifact, audit, or evidence-receipt
  references.
* An explicit workspace-contained output path or an existing pack path for
  validation/rendering.

## Outputs

* A canonical pack containing externally labeled claims, an index of safe
  references, content-derived identity, timestamp, and SHA-256 integrity.
* Validation status/trust and exit status that distinguish valid current content
  from expired references, legacy formats, and unsupported input.

## Rules

* R1: A pack indexes references; it never copies or rereads their source
  evidence during rendering. The closed reference variants are:
  * Verification artifact: kind, id, created time, status, and subject kind.
  * Audit: kind, id, created time, logical connection name, bounded redacted
    command, success, and optional recovery reference.
  * Receipt: kind, id, created time, operation, outcome, digest, and bounded
    workspace-relative path.
* R2: Claims are externally supplied statements, visibly non-verdicts, and must
  not include SQL, credentials, errors, or blacklisted identifiers.
* R3: Composition requires unique safe references and a matching verification
  subject kind where applicable; pack content is canonical and identity derives
  from its SHA-256 digest.
* R4: Output remains inside the workspace, is atomically created, and never
  overwrites an existing pack.
* R5: Validation verifies format, exact structure, digest, and derived ID;
  source expiration is reported separately from current-content integrity.
* R6: A source-expired current pack remains renderable for historical review.
  Legacy and unsupported packs are never current-valid; legacy packs are not
  migrated.
* R7: Pack composition, validation, and rendering never decide claim truth or
  authorize/execute a database operation.
* R8: Unknown reference fields and raw source bodies are rejected. Safe logical
  names, status metadata, reference IDs, and workspace-relative receipt paths
  remain part of the versioned pack contract.

## Expected Errors

* Missing, malformed, duplicate, unsafe, or subject-mismatched claims/references
  fail with bounded output and do not write a pack.
* Outside-workspace, symlink-escaping, or existing output paths fail without
  overwriting files.
* Invalid digest/ID, unknown version, version-structure mismatch, and legacy
  artifacts report their bounded classification and never become current-valid.

## Dependencies

* Existing evidence-pack, evidence receipt, verification artifact, audit,
  blacklist, canonical JSON/digest, and workspace-path boundaries.

## Constraints

* The pack is an offline index and external-claim handoff, not a truth engine.
* Do not add dependencies or duplicate source evidence in output.
* Keep `docs/user/en/index.md`, `docs/user/en/index.html`,
  `docs/user/zh-TW/index.md`, and `docs/user/zh-TW/index.html` aligned.
* Use `make verify` as the completion gate.

## Superseded Behavior

* `tests/unit/core/evidence-pack/evidence-pack.test.ts` — its canonical
  structure, digest, and identity assertions are the baseline; this Story's
  R1, R3, and R5 take precedence where a validated pack field differs.
* `tests/unit/core/evidence-pack/evidence-pack-legacy.test.ts` — its
  legacy/unsupported classification assertions are the baseline; R6 takes
  precedence where current-valid-versus-legacy classification differs.
* `tests/integration/evidence-command.test.ts` — its `evidence compose`,
  `evidence validate`, and `evidence render` command-behavior assertions are
  the baseline; this Story's Rules take precedence where a command outcome
  differs.
* `tests/integration/evidence-legacy-command.test.ts` — its legacy-pack
  handling assertions are the baseline; R6's no-migration rule takes
  precedence where legacy-pack behavior differs.
* `docs/guides/en/evidence-packs.html` — its published review/handoff and
  claims-versus-references narrative is the baseline; this Story's Rules take
  precedence where a documented step or boundary differs.
* `docs/user/en/index.md` and `docs/user/zh-TW/index.md` — their existing
  evidence-pack usage descriptions are the baseline; this Story's Rules take
  precedence where documented behavior differs.
