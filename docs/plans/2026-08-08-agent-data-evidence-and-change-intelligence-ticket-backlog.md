# Agent Data Evidence and Change Intelligence — Ticket Backlog

**Date:** 2026-08-08

**Status:** Proposed — no ticket is implementation authorization by itself.

**Specification:**
[`Agent Data Evidence and Change Intelligence`](../specs/2026-08-08-agent-data-evidence-and-change-intelligence.md)

## Purpose

This backlog turns the approved design into independently reviewable vertical
slices. Ticket IDs are local planning identifiers, not GitHub issues. Every
ticket inherits the existing permission, blacklist, execution-path, audit,
recovery, and verification authority; none adds an MCP/provider surface,
automatic mutation, generic verification DSL, or generic source-code parser.

## Dependency map

```text
EVD-01 evidence-pack v1 ──> EVD-02 assert receipt ──> EVD-03 verify receipt

CON-01 semantic contracts v1 ──┐
                               ├──> IMP-02 baseline impact ──┬──> IMP-03 access manifest
IMP-01 physical-change normalize ─┘                           └──> IMP-04 workload
```

`EVD-01` and `CON-01` can proceed independently. `IMP-01` is intentionally a
small prerequisite because existing design drift expresses desired-vs-actual
difference, not a directionally safe migration change set. `IMP-03` and
`IMP-04` are optional enrichment: the baseline impact workflow must remain
useful without them and report their absence as coverage gaps.

---

## EVD-01 — Evidence Pack v1

**Status:** Proposed

**Depends on:** Existing verification artifact reader and audit/recovery reader

**Outcome:** Deliver the first end-to-end, offline evidence workflow:
`dbcli evidence compose|validate|render`, using existing verification artifacts
and safe audit/recovery reference projections.

**Scope:**

- Build the `src/core/evidence-pack` deep module: strict v1 codec, bounded
  claims/references, canonical serialization, SHA-256 digest, digest validation,
  safe Markdown/JSON rendering, and explicit-output writer.
- Add `compose --claims … --verification … [--audit …] --output …`, `validate`,
  and `render` commands. `compose` is the only writer; it writes canonical JSON
  only when all explicitly selected sources resolve safely.
- Resolve audit and recovery identity only through existing readers and retain
  a restricted safe projection. Never copy `AuditEntry` wholesale: its query,
  SQL, error, and arbitrary metadata fields are not pack payload.
- Define the lifecycle precisely: a missing/disabled/unavailable explicitly
  requested source fails composition; a reference that expires later through
  audit rotation/clear yields non-zero `source-expired` reference validation
  plus a coverage gap, while digest validation and forensic rendering remain
  available.
- Update four-way user docs and generated skill/platform guidance. Claims must
  visibly remain external interpretation, not a dbcli verification verdict.

**Non-goals:** Receipt capture, command replay, audit-log duplication, raw
result export, archive/import support, signing, or authentication.

**Acceptance criteria:**

1. All three commands are offline and cause no adapter/database call.
2. Unknown keys, invalid digest, duplicate IDs, missing required source,
   unsafe/malformed reference, oversized input, and contained-path violation
   fail closed.
3. Equivalent claim/reference sets produce canonical identical JSON and digest.
4. Tampering is detected; expired provenance is neither hidden nor misreported
   as a valid reference.
5. JSON/Markdown never exposes rows, raw SQL, credentials, raw error body, or
   unredacted argv; it labels claims as external.

**Verification:** Focused core/integration/security tests, `bun test`, `bun
run typecheck`, `bun run lint`, `bun run docs:check`, `bun run skill:check`,
`bun run platform:check`, `bun run plugin:check`, `bun run contract:check`, and
`git diff --check`.

---

## CON-01 — Semantic Contracts v1

**Status:** Proposed

**Depends on:** Existing filtered semantic context and saved-query registry

**Outcome:** Deliver a separate, reviewable `dbcli.contracts.json` and
`dbcli contract validate|context|search|drift` workflow. It adds stewardship and
evidence expectation to governed business terms without changing the existing
semantic format or creating executable contracts.

**Scope:**

- Build `src/core/contracts` with strict v1 parsing, deterministic
  normalization/rendering, validated semantic-subject references, and drift
  inspection.
- Reuse the semantic module's canonical-reference registry and filtered-schema
  rules; do not parse schema or reimplement blacklist behavior in contracts.
- Support only the specified `draft`/`approved`/`deprecated` lifecycle and
  bounded descriptive evidence policies.
- Add the command group and include only valid approved contracts in ordinary
  `skill context`; absent contract file is valid, explicit missing/invalid file
  fails safely.
- Update four-way user docs and generated skill assets.

**Non-goals:** Semantic v3, SQL/query execution, contract evaluation, user
defined assertion/verify DSL, contract file writes, or provider generation.

**Acceptance criteria:**

1. Unknown, duplicate, noncanonical, stale, and blacklisted subjects fail
   closed without leaking protected names.
2. Default context/search uses approved valid contracts only; draft,
   deprecated, or stale contracts cannot silently influence agent context.
3. Missing contract file leaves existing semantic and skill-context behavior
   unchanged; contract drift runs offline and distinguishes valid/stale/invalid/
   unavailable inputs.
4. No command introduces a database connection or widens `QueryDraft` or
   execution permission.

**Verification:** Focused core/command tests, then EVD-01's completion gate.

---

## IMP-01 — Normalize a physical proposed change

**Status:** Proposed

**Depends on:** Existing Design Assistant, normalized schema, and ORM drift
comparison

**Outcome:** Translate an explicit design-vs-cache or design-vs-ORM comparison
into a directionally correct internal `NormalizedChangeSet` for impact analysis.

**Scope:**

- Add an internal adapter adjacent to existing design/ORM diff code that labels
  objects as proposed additions, removals, or modifications relative to the
  declared target and actual baseline.
- Carry connection/catalog scope, object kind, canonical identity, and source
  location needed by impact. Keep the type internal to the impact/design seam;
  do not introduce a speculative shared artifact registry.
- Reject or mark unsupported/lossy/ambiguous cases with explicit coverage data.

**Non-goals:** A CLI command, live schema refresh, migration generation,
execution, semantic lookup, or source-code analysis.

**Acceptance criteria:**

1. Equivalent design/cache/ORM inputs produce deterministic change identity
   and order.
2. A design-only missing object is never misclassified as a removal; reverse
   direction and modified-field cases have focused regression coverage.
3. Ambiguous qualified/cross-connection identities cannot collapse into the
   same change subject.

**Verification:** Focused normalization tests, `bun run typecheck`, `bun run
lint`, and `git diff --check`.

---

## IMP-02 — Baseline impact assessment and CLI

**Status:** Proposed

**Depends on:** CON-01 and IMP-01

**Outcome:** Deliver `dbcli impact assess` for a proposed physical change and
its known governed dependencies, with honest coverage and CI-safe exit rules.

**Scope:**

- Build `src/core/impact` around a small `assessImpact(input)` interface that
  joins `NormalizedChangeSet` with semantic/contracts, saved-query metadata,
  and safely available verification metadata.
- Emit stable source-located findings, recommended verification, and
  `partial`/`declared` coverage only. Never report `complete` in v1.
- Add `impact assess --design … (--against-cache | --against-orm …)` with
  explicit output path, JSON/Markdown format, and `--fail-on error|warn|never`.
- Reuse existing design/ORM/cache normalization; do not connect, refresh schema,
  execute SQL, parse arbitrary source, or inspect internal verify scenarios.
- Treat absent semantic/contracts/saved-query/verification sources as visible
  coverage gaps. Use stable artifact metadata only; do not publish the internal
  `VerifyScenarioDefinition` seam.
- Update four-way docs and skill routing for PR/CI use.

**Non-goals:** Data-access manifest, proxy events, automatic PR comments,
migration execution, or safety certification from an empty finding list.

**Acceptance criteria:**

1. Removed/modified visible schema objects deterministically trace to known
   semantic contracts, saved-query metadata, and safe verification metadata.
2. Direct/transitive traversal is cycle-safe and ordered; every omission has an
   explicit source or coverage explanation.
3. `--fail-on` changes only process exit code, never report findings; required
   option/path errors fail before any local DB activity.
4. Output contains no protected identifier, SQL body, row, credential, or raw
   error and all unavailable inputs remain visible as gaps.

**Verification:** Focused core/integration tests, then EVD-01's completion
gate.

---

## IMP-03 — Declared data-access manifest

**Status:** Proposed

**Depends on:** IMP-02

**Outcome:** Enrich impact reports with explicitly reviewed code-to-data
dependency hints from `dbcli.data-access.json`, without claiming to parse all
application code.

**Scope:**

- Add strict parser/normalizer for the optional manifest and an impact adapter.
- Require unique operation name/kind, workspace-contained source path,
  canonical semantic subjects, and mandatory `coverage: "declared"` per
  operation.
- Render affected declared operations with source location and warning severity;
  retain dynamic/unlisted code as a coverage gap.

**Non-goals:** Reading declared source, static TypeScript/ORM/raw-SQL parsing,
call-graph inference, or `complete` coverage.

**Acceptance criteria:**

1. Path traversal/symlink escape, duplicate operation, unknown/blacklisted
   subject, and missing declared coverage fail safely.
2. Affected operations produce stable source-located warnings; no manifest can
   grant database or verification authority.
3. Absent/invalid optional manifest is reported as coverage, never clean
   analysis.

**Verification:** Focused parser/adapter tests plus IMP-02 command checks.

---

## IMP-04 — Advisory proxy-workload impact adapter

**Status:** Proposed

**Depends on:** IMP-02 and existing proxy/querylens redaction

**Outcome:** Add recently observed query behavior as bounded advisory impact
evidence, distinct from code coverage or a migration blocker.

**Scope:**

- Consume an explicit event path through a redaction-first adapter outside the
  impact renderer; retain only supported table/fingerprint references, bounded
  timeframe, malformed-line count, and source availability metadata.
- Join safe observations into `AFFECTED_OBSERVED_WORKLOAD` warnings only.

**Non-goals:** Starting a proxy, retaining a new log, raw SQL/error display,
performance tuning, auto-indexing, or blocking solely on workload.

**Acceptance criteria:**

1. Missing, malformed, stale, unreadable, or redaction-failed input produces a
   coverage gap, never a clean report.
2. No literal, parameter, error body, or protected identifier reaches the
   impact report.
3. Existing proxy/querylens behavior and output remain unchanged.

**Verification:** Focused adapter/security tests and IMP-02 command checks.

---

## EVD-02 — Assert evidence receipts

**Status:** Proposed

**Depends on:** EVD-01 and existing assert/audit/verification contracts

**Outcome:** Add `--evidence-receipt <path>` to `dbcli assert` as the first
explicit operation receipt, proving the receipt contract before query/explain
capture is considered.

**Scope:**

- Build the receipt writer from already-redacted argv, resolved connection/
  environment identity, safe schema/semantic fingerprints, audit reference,
  verification artifact reference, and bounded assert-verdict fingerprint.
- Write atomically only when explicitly requested and only after existing assert
  outcome/artifact creation is authoritative.
- Make receipts a safe evidence-pack reference without adding a verification
  status or second audit/recovery identifier.

**Non-goals:** Query/explain receipt, automatic creation, raw result storage,
receipt import, or new adapter path.

**Acceptance criteria:**

1. Without the option, assert output and audit/verification lifecycle are
   unchanged.
2. A receipt cannot misreport assert success if its write fails; audit
   best-effort unavailability is explicit safe provenance metadata, never a
   fabricated audit ID.
3. Receipt output contains no row, SQL, literal, credential, arbitrary path, or
   raw error and is cross-linkable to existing artifacts.
4. Execution-path review proves the option adds no route to an adapter and does
   not weaken query-only behavior.

**Verification:** Focused unit/integration/security tests, execution-path
contract tests, then EVD-01's completion gate.

---

## EVD-03 — Verify evidence receipts

**Status:** Proposed

**Depends on:** EVD-02 and existing built-in verify scenarios

**Outcome:** Extend the shared receipt contract to `dbcli verify` while keeping
the scenario registry private and task packs plan-only.

**Scope:**

- Add `--evidence-receipt <path>` to `verify` after each built-in scenario's
  existing outcome and verification artifact are determined.
- Keep planned task-pack evidence distinct from executed verification evidence;
  never add `planned` to `VerificationStatus`.
- Emit a safe, stable unsupported error for any built-in scenario that cannot
  produce a conforming receipt; never silently omit a requested receipt.
- Update docs/skill guidance to say a receipt is provenance, not execution
  approval.

**Non-goals:** External scenarios/plugins, task-pack execution, scenario DSL,
write verification, or query/explain receipts.

**Acceptance criteria:**

1. Each supported built-in scenario produces a conforming receipt on explicit
   request or fails safely and visibly as unsupported.
2. Receipt outcome and scenario verification status remain separate through
   `verified`, `not_verified`, `indeterminate`, and `blocked` paths.
3. Option absence preserves existing verify output, artifact schema, registry
   privacy, and plan-only semantics.
4. Tests cover all built-in outcomes and redaction/path-containment failures.

**Verification:** Scenario-focused tests, execution-path contract tests, then
EVD-01's completion gate.

## Deferred work outside this backlog

These remain blocked by the parent specification's re-gates: query/explain
receipts; provider-generated claims/contracts; generic source/call-graph
analysis or a mutable knowledge graph; external verification scenarios; and
MCP/HTTP/GUI/dashboard/automatic PR-comment or migration/backfill features.
