# Agent Data Evidence and Change Intelligence — Ticket Backlog

**Date:** 2026-08-08

**Status:** All eight tickets delivered in v1.53.0 (2026-08-09). Two carry known
deviations; see each ticket. Whether those deviations get repaired is governed by
[ADR-0011](../adr/0011-evidence-subsystem-waits-for-a-user-before-it-is-repaired.md).

Every acceptance criterion below ends with either `— covered by: <test>` naming
the test that asserts it, or `— known deviation: <reason>`. A drift guard that
enforces this convention follows in a separate change.

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

**Status:** Delivered in v1.53.0 (2026-08-09). Both known deviations were
repaired on 2026-08-16 under
[ADR-0012](../adr/0012-known-defects-get-fixed-whether-or-not-anyone-is-using-the-code.md).
Unverified: criteria 1, 2, and 5.

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
  available. — covered by: `tests/integration/evidence-command.test.ts`
  (`reports source-expired after audit retention while rendering remains
  available`). The promised coverage gap was unreachable and the `coverage`
  field is now removed rather than faked: a pack is immutable, so a reference
  that expires after composition cannot be written back into it. Expiry is
  reported by `evidence validate`, which is where a reader can act on it —
  asserted by `tests/unit/core/evidence-pack/evidence-pack.test.ts` (`does not
  carry a coverage field`, `rejects a pack that still carries the removed
  coverage field`).
- Update four-way user docs and generated skill/platform guidance. Claims must
  visibly remain external interpretation, not a dbcli verification verdict.

**Non-goals:** Receipt capture, command replay, audit-log duplication, raw
result export, archive/import support, signing, or authentication.

**Acceptance criteria:**

1. All three commands are offline and cause no adapter/database call. —
   unverified: `tests/unit/core/execution-path-contract.test.ts` asserts
   structurally that no unregistered adapter call exists, but no test asserts
   that these commands attempt zero connections.
2. Unknown keys, invalid digest, duplicate IDs, missing required source,
   unsafe/malformed reference, oversized input, and contained-path violation
   fail closed. — unverified: unknown keys, invalid digest, and contained-path
   violation are asserted in
   `tests/unit/core/evidence-pack/evidence-pack.test.ts`; duplicate IDs, missing
   required source, oversized input, and malformed reference objects have no
   test.
3. Equivalent claim/reference sets produce canonical identical JSON and digest.
   — covered by: `tests/unit/core/evidence-pack/evidence-pack.test.ts`
   (`composing the same claims and references twice produces the same digest`,
   `derives the pack id from its content digest`, `validates a pack whose keys
   are stored in a different order`). The digest now covers content only and the
   id is derived from it; `createdAt` is metadata outside the digest, which is
   the one field a restamp can change undetected.
4. Tampering is detected; expired provenance is neither hidden nor misreported
   as a valid reference. — covered by:
   `tests/unit/core/evidence-pack/evidence-pack.test.ts` (`canonicalizes claims
   and produces a tamper-evident pack`) and
   `tests/integration/evidence-command.test.ts` (`reports source-expired after
   audit retention while rendering remains available`).
5. JSON/Markdown never exposes rows, raw SQL, credentials, raw error body, or
   unredacted argv; it labels claims as external. — unverified: rows, raw SQL,
   audit metadata, Markdown injection, and the external-claim label are asserted
   in `tests/integration/evidence-command.test.ts` and
   `tests/unit/core/evidence-pack/evidence-pack.test.ts`; credentials, raw error
   body, and unredacted argv are asserted only at claim input, never on rendered
   output.

**Verification:** Focused core/integration/security tests, `bun test`, `bun
run typecheck`, `bun run lint`, `bun run docs:check`, `bun run skill:check`,
`bun run platform:check`, `bun run plugin:check`, `bun run contract:check`, and
`git diff --check`.

---

## CON-01 — Semantic Contracts v1

**Status:** Delivered in v1.53.0 (2026-08-09). Unverified: criteria 3 and 4.

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
   closed without leaking protected names. — covered by:
   `tests/unit/core/contracts/contracts.test.ts` (`fails closed for strict shape
   and unsafe semantic subjects without naming protected terms`, `fails closed
   for unknown or noncanonical subjects and markdown-shaped text`, `classifies
   offline drift without re-reading semantic sources`).
2. Default context/search uses approved valid contracts only; draft,
   deprecated, or stale contracts cannot silently influence agent context. —
   covered by: `tests/unit/commands/contracts.test.ts` (`context and search
   expose only approved valid contracts`) and
   `tests/unit/core/context/context.test.ts` (`gatherContext exposes only
   approved valid semantic contracts`, `gatherContext fails closed when
   contracts exist without semantic evidence`).
3. Missing contract file leaves existing semantic and skill-context behavior
   unchanged; contract drift runs offline and distinguishes valid/stale/invalid/
   unavailable inputs. — unverified: valid, stale, and both unavailable cases
   are asserted in `tests/unit/core/contracts/contracts.test.ts`; the `invalid`
   drift branch (`src/core/contracts/index.ts:104,116`) has no test, and no test
   asserts that an absent contract file leaves skill context unchanged.
4. No command introduces a database connection or widens `QueryDraft` or
   execution permission. — unverified: only the repo-wide
   `tests/unit/core/execution-path-contract.test.ts` covers this structurally;
   no contract-specific test asserts that the commands stay offline, and no test
   relates contracts to `QueryDraft` at all.

**Verification:** Focused core/command tests, then EVD-01's completion gate.

---

## IMP-01 — Normalize a physical proposed change

**Status:** Delivered in v1.53.0 (2026-08-09). Every acceptance criterion is
asserted. Implemented in `src/core/orm-drift/change-set.ts`, not under
`src/core/impact/`, which only imports its types.

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
   and order. — covered by: `tests/unit/core/orm-drift/change-set.test.ts`
   (`orders equivalent shuffled inputs deterministically`).
2. A design-only missing object is never misclassified as a removal; reverse
   direction and modified-field cases have focused regression coverage. —
   covered by: `tests/unit/core/orm-drift/change-set.test.ts` (`labels a
   declared-only table as a proposed addition with its declared origin`,
   `reversing declared and baseline labels the object as a removal`, `emits a
   directional column modification with before and after values`).
3. Ambiguous qualified/cross-connection identities cannot collapse into the
   same change subject. — covered by:
   `tests/unit/core/orm-drift/change-set.test.ts` (`uses every declared scope
   component in the identity so changes cannot collapse`, `keeps
   schema-qualified table identities separate`, `rejects identities that collide
   after the baseline default schema is applied`).

**Verification:** Focused normalization tests, `bun run typecheck`, `bun run
lint`, and `git diff --check`.

---

## IMP-02 — Baseline impact assessment and CLI

**Status:** Delivered in v1.53.0 (2026-08-09). Known deviation: the `declared`
coverage level in Scope. Unverified: all four criteria.

**Depends on:** CON-01 and IMP-01

**Outcome:** Deliver `dbcli impact assess` for a proposed physical change and
its known governed dependencies, with honest coverage and CI-safe exit rules.

**Scope:**

- Build `src/core/impact` around a small `assessImpact(input)` interface that
  joins `NormalizedChangeSet` with semantic/contracts, saved-query metadata,
  and safely available verification metadata.
- Emit stable source-located findings, recommended verification, and
  `partial`/`declared` coverage only. Never report `complete` in v1. — known
  deviation: `declared` is unreachable. It requires an empty gap list
  (`src/core/impact/index.ts:219`), but the data-access join always adds a gap
  (`:262-263`), so the level is always `partial`. `complete` is excluded by the
  type, not by a test.
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
   semantic contracts, saved-query metadata, and safe verification metadata. —
   unverified: the removal path is asserted in
   `tests/unit/core/impact/impact.test.ts` (`traverses physical changes through
   approved contracts to known saved queries`); the `modify` operation has no
   test.
2. Direct/transitive traversal is cycle-safe and ordered; every omission has an
   explicit source or coverage explanation. — unverified: cycle safety is
   asserted in `tests/unit/core/impact/impact.test.ts` (`is cycle-safe and
   deterministic across semantic input order`), but that test compares one
   report against its own sorted ids rather than two input orders, and
   `SAVED_QUERY_REFERENCE_UNAVAILABLE` (`src/core/impact/index.ts:185`) has no
   test.
3. `--fail-on` changes only process exit code, never report findings; required
   option/path errors fail before any local DB activity. — unverified:
   `tests/unit/commands/impact.test.ts` asserts the `warn` and `never` paths
   (`writes identical findings before --fail-on changes only the exit code`);
   the `error` branch has no test, and nothing asserts that option validation
   precedes local reads — it does not (`src/commands/impact.ts:161-165` runs
   after `:104-110`).
4. Output contains no protected identifier, SQL body, row, credential, or raw
   error and all unavailable inputs remain visible as gaps. — unverified:
   protected identifiers, SQL bodies, and gap visibility are asserted across
   `tests/unit/core/impact/impact.test.ts` and
   `tests/unit/commands/impact.test.ts`; credentials and raw error bodies have
   no test.

**Verification:** Focused core/integration tests, then EVD-01's completion
gate.

---

## IMP-03 — Declared data-access manifest

**Status:** Delivered in v1.53.0 (2026-08-09). Unverified: criteria 2 and 3.

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
   subject, and missing declared coverage fail safely. — covered by:
   `tests/unit/core/data-access/data-access.test.ts` (`rejects traversal and
   source symlinks outside the workspace`, `rejects a manifest symlink before
   reading an external file`, `rejects duplicate names, unknown references, and
   missing declared coverage without exposing protected text`).
2. Affected operations produce stable source-located warnings; no manifest can
   grant database or verification authority. — unverified: the warning shape is
   asserted in `tests/unit/core/impact/impact.test.ts` (`emits one stable
   warning for each affected declared access operation`); nothing asserts that a
   manifest cannot grant database or verification authority.
3. Absent/invalid optional manifest is reported as coverage, never clean
   analysis. — unverified: the invalid case is asserted in
   `tests/unit/commands/impact.test.ts` (`records an invalid optional
   data-access manifest as coverage without leaking its path`); no test asserts
   the `DATA_ACCESS_ABSENT` or `DATA_ACCESS_UNAVAILABLE` gaps reach a report.

**Verification:** Focused parser/adapter tests plus IMP-02 command checks.

---

## IMP-04 — Advisory proxy-workload impact adapter

**Status:** Delivered in v1.53.0 (2026-08-09). Unverified: criteria 1 and 3.

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
   coverage gap, never a clean report. — unverified: missing, malformed, stale,
   and redaction-failed inputs are asserted in
   `tests/unit/core/workload-impact/workload-impact.test.ts` and mapped to gaps
   in `tests/unit/core/impact/impact.test.ts`; the unreadable case
   (`state: 'unavailable'`, `src/core/workload-impact/index.ts:57,115,121`) and
   the `WORKLOAD_UNAVAILABLE` and `WORKLOAD_INVALID` gaps have no test.
2. No literal, parameter, error body, or protected identifier reaches the
   impact report. — covered by:
   `tests/unit/core/workload-impact/workload-impact.test.ts` (`returns only
   bounded redacted metadata from recent completed events`) and
   `tests/unit/commands/impact.test.ts` (`joins explicit proxy workload metadata
   as advisory evidence without leaking event contents`).
3. Existing proxy/querylens behavior and output remain unchanged. — unverified:
   no test asserts this. The adapter builds its own reader and only imports
   `applyRedaction`, which is an argument from structure, not an assertion.

**Verification:** Focused adapter/security tests and IMP-02 command checks.

---

## EVD-02 — Assert evidence receipts

**Status:** Delivered in v1.53.0 (2026-08-09). Unverified: all four criteria.
No test runs `dbcli assert --evidence-receipt`.

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
   unchanged. — unverified: no test exercises `assert --evidence-receipt` at
   all, so nothing asserts what its absence preserves. The nearest test covers
   `--write-verification-artifact`, a different option.
2. A receipt cannot misreport assert success if its write fails; audit
   best-effort unavailability is explicit safe provenance metadata, never a
   fabricated audit ID. — unverified: the write-failure path
   (`src/commands/assert.ts:205-207`) has no test;
   `tests/unit/core/evidence-receipt/evidence-receipt.test.ts` passes a null
   `auditRef` through a round trip without asserting it stays null.
3. Receipt output contains no row, SQL, literal, credential, arbitrary path, or
   raw error and is cross-linkable to existing artifacts. — unverified: path
   stripping and argv redaction are asserted in
   `tests/unit/core/evidence-receipt/evidence-receipt.test.ts` and
   `tests/unit/utils/redaction.test.ts`; no test links an assert receipt back to
   a real artifact or feeds one to `evidence compose`.
4. Execution-path review proves the option adds no route to an adapter and does
   not weaken query-only behavior. — unverified: the repo-wide
   `tests/unit/core/execution-path-contract.test.ts` covers the adapter half; no
   test runs this option under `query-only` permission.

**Verification:** Focused unit/integration/security tests, execution-path
contract tests, then EVD-01's completion gate.

---

## EVD-03 — Verify evidence receipts

**Status:** Delivered in v1.53.0 (2026-08-09). Unverified: criterion 3.

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
   request or fails safely and visibly as unsupported. — covered by:
   `tests/unit/commands/verify-receipt.test.ts` (`writes a receipt for every
   built-in scenario and preserves all status distinctions`, `records an
   artifact-write failure separately and rejects ambiguous audit provenance`)
   and `tests/integration/verify-help.test.ts` (`preflight rejects an evidence
   receipt before any database configuration is read`). End-to-end CLI coverage
   exists for three of the four scenarios and is skipped without a database.
2. Receipt outcome and scenario verification status remain separate through
   `verified`, `not_verified`, `indeterminate`, and `blocked` paths. — covered
   by: `tests/unit/core/evidence-receipt/evidence-receipt.test.ts` (`keeps each
   verify status distinct from its coarse receipt outcome`).
3. Option absence preserves existing verify output, artifact schema, registry
   privacy, and plan-only semantics. — unverified: no test asserts that no
   receipt is written without the option; `tests/unit/core/verify/registry.test.ts`
   imports `BUILTIN_VERIFY_SCENARIOS` directly rather than asserting the
   registry stays private; nothing asserts plan-only semantics.
4. Tests cover all built-in outcomes and redaction/path-containment failures. —
   covered by: `tests/unit/commands/verify-receipt.test.ts` (all four outcomes,
   redaction of a seeded `UPDATE private_orders …` argv, and `fails safely for
   receipt collisions and symlink traversal after the artifact is
   authoritative`).

**Verification:** Scenario-focused tests, execution-path contract tests, then
EVD-01's completion gate.

## Deferred work outside this backlog

These remain blocked by the parent specification's re-gates: query/explain
receipts; provider-generated claims/contracts; generic source/call-graph
analysis or a mutable knowledge graph; external verification scenarios; and
MCP/HTTP/GUI/dashboard/automatic PR-comment or migration/backfill features.
