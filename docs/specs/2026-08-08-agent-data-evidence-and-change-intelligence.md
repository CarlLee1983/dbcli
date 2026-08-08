# Agent Data Evidence and Change Intelligence

**Date:** 2026-08-08
**Status:** Proposed — specification only; no implementation is authorized by
this document
**Depends on:** the semantic context roadmap, verification artifacts, audit and
recovery contracts, and the Design Assistant
**Supersedes:** nothing

## 1. Decision summary

dbcli is not only a safe database command runner. Its differentiated product
promise is that an agent can perform database-related development work with
evidence a developer, reviewer, or CI job can inspect afterwards.

The next product layer is therefore **Agent Data Evidence and Change
Intelligence**. It closes three linked gaps without adding a second database
execution path:

1. **Evidence packs** turn a conclusion or release claim into reviewable
   provenance rather than an untraceable chat assertion.
2. **Semantic contracts** let a team govern business definitions alongside the
   existing physical schema and saved-query references.
3. **Impact assessments** explain the known blast radius of a proposed
   schema/design change before a migration or code change is presented as safe.

The shared rule is deliberately strict: dbcli may prove an operation, an
observation, or a failed check. It must never infer that an agent's natural
language conclusion is true merely because that conclusion is attached to
evidence.

## 2. Product boundary

The target user is an AI-assisted developer who is implementing, debugging,
reviewing, or releasing a feature whose correctness depends on database state.
The value is not generic natural-language SQL generation. It is the missing
completion loop:

```text
governed context
  -> explicit investigation or change plan
  -> existing dbcli safety gates and execution
  -> receipts / verification evidence
  -> evidence pack and impact assessment for review or CI
```

This proposal builds on, rather than replaces, these current authorities:

| Concern | Existing authority | This proposal's role |
| --- | --- | --- |
| Permission, blacklist, schema visibility, execution | command guards and adapters | consume their already-filtered result; never grant access |
| Operation provenance | audit entries and recovery envelopes | reference them; never duplicate their redaction or identity logic |
| Verification outcome | `VerificationArtifact` | compose it into a pack; do not add another verification status vocabulary |
| Business vocabulary | `dbcli.semantic.json` | link a separate, governed contract artifact to its canonical references |
| Desired relational shape | `dbcli.design.json` and ORM/schema diff | consume their normalized change set |
| Observed runtime behavior | proxy/querylens events | add bounded, advisory impact evidence |

### 2.1 Non-goals

- No LLM provider, prompt transport, embeddings, vector store, web service,
  dashboard, GUI, or MCP server.
- No automatic migration, data backfill, query execution, or mutation from an
  evidence, contract, or impact command.
- No generic external verification-scenario DSL. The existing decision to keep
  `VerifyScenarioDefinition` internal remains in force.
- No claim that static analysis or workload logs identify all application code
  affected by a schema change.
- No storage of database rows, raw query text, credentials, blacklisted names,
  or an unbounded application source snapshot in the new artifacts.
- No replacement for audit, verification, result snapshots, semantic context,
  design specs, or task packs.

## 3. Canonical terms

The following vocabulary is authoritative for this proposal and is also
recorded in `CONTEXT.md`.

| Term | Meaning | Explicitly not |
| --- | --- | --- |
| **Evidence receipt** | Bounded record of one explicit operation and its safe, reproducible metadata. | A raw result export, audit-log replacement, or conclusion. |
| **Evidence pack** | A reviewable composition of claims and referenced evidence. | Proof that a claim is true. |
| **Claim** | Short, external, human/agent-authored text such as “the migration preserved active-order counts.” | A dbcli verdict or executable assertion. |
| **Semantic contract** | An approved business definition, linked to valid semantic references and an evidence expectation. | A schema contract, ACL, or arbitrary SQL test. |
| **Data subject** | A stable, connection-scoped identity for a governed physical or semantic object. | An unqualified table name that can collide across connections. |
| **Impact assessment** | Deterministic known-dependency report for a proposed change. | Complete program analysis or release approval. |
| **Coverage gap** | A declared place where available evidence cannot prove absence of impact. | A passing result. |

`verified`, `not_verified`, `indeterminate`, and `blocked` retain their existing
meaning exclusively for verification artifacts. An evidence pack never emits
one of those statuses for a claim.

## 4. Invariants and safety constraints

Every slice must preserve these rules:

1. **Existing authority wins.** Permission levels, filtered schema, blacklist,
   engine capabilities, DML planning, and execution gates remain authoritative.
   A valid contract or receipt cannot widen any of them.
2. **No implicit connection.** Composition, validation, semantic contract, and
   impact commands run offline. Only an explicitly invoked existing query,
   explain, assert, or verify command may create an operation receipt.
3. **No sensitive payload retention.** New artifacts contain neither result
   rows nor raw SQL. They use the established audit redaction path and stable
   hashes/fingerprints only. The writer must fail closed if safe redaction or
   fingerprinting cannot be established.
4. **Explicit writes only.** Artifact creation requires an explicit output
   path. Default commands remain read-only and must not create `.dbcli/` state
   as a side effect.
5. **Deterministic and bounded.** Parsers reject unknown keys, impose file,
   collection, and string limits, sort outputs deterministically, and avoid
   timestamps except in newly created artifact metadata.
6. **No false completeness.** Impact output always carries a coverage section;
   unavailable inputs are warnings, not an empty “safe” report.
7. **CLI remains the only access surface.** This specification follows
   ADR-0004; it creates no server or alternate adapter path.

## 5. Architecture

Three peer deep modules form a small, one-way dependency graph. Data-subject
identity belongs first to the impact/change-set seam, where connection scope,
object kind, and canonical reference are all needed. It may be extracted as a
shared internal value object only when a second delivered consumer proves the
need; this proposal does not authorize a generic artifact registry.

```text
schema / design / saved-query / semantic
                 |                 |
                 v                 v
          src/core/contracts   src/core/impact
                 \                 /
                  \               /
                   v             v
                 src/core/evidence-pack
```

`contracts` and `impact` may consume normalized values from existing modules.
`evidence-pack` is a one-way aggregation sink: it may include safe outputs from
the other modules but cannot be imported by them. No module imports `impact`.
Commander registration, explicit file I/O, config loading, output format, and
exit codes stay in command modules. No caller may parse the new JSON formats,
filter blacklist data, or reproduce redaction itself.

### 5.1 Artifact locations

| Artifact | Default / intended path | Git policy |
| --- | --- | --- |
| Semantic context | `dbcli.semantic.json` | Committed and reviewed |
| Semantic contracts | `dbcli.contracts.json` | Committed and reviewed |
| Optional code access manifest | `dbcli.data-access.json` | Committed and reviewed |
| Receipts and composed packs | user-supplied path; suggested `.dbcli/evidence/` | Local by default; never assumed safe to commit |
| Impact assessment | stdout by default; explicit `--output` for a file | CI output or committed only by project policy |

`dbcli.design.json` remains the desired physical-design source of truth; it is
not copied into either new artifact.

## 6. Capability A — evidence packs

### 6.1 Outcome

An agent can hand off a database-related conclusion with its bounded evidence:
which governed connection context was involved, what operation produced the
evidence, which verification artifact/audit event applies, and whether the
evidence is stale or unavailable. A reviewer can replay the explicit commands
where current permission permits it.

The initial use cases are:

- attach a database verification outcome to a migration or backfill PR;
- preserve evidence for an incident/data-bug investigation without exporting
  rows into chat, logs, or a ticket;
- give a release reviewer a compact answer to “what did the agent actually
  check?”

### 6.2 Receipt contract

`EvidenceReceipt` is an internal value object with a versioned, persisted JSON
form when explicitly requested. v1 contains only:

```json
{
  "version": 1,
  "id": "evr_…",
  "createdAt": "2026-08-08T00:00:00.000Z",
  "operation": "assert",
  "outcome": "succeeded",
  "context": {
    "engine": "postgresql",
    "connectionName": "staging",
    "environment": "staging",
    "schemaFingerprint": "sha256:…",
    "semanticFingerprint": "sha256:…"
  },
  "provenance": {
    "command": "dbcli assert …",
    "commandHash": "sha256:…",
    "auditRef": "…",
    "verificationArtifactRef": "…"
  },
  "replay": { "status": "context-required" },
  "observation": {
    "kind": "assert-verdict",
    "fingerprint": "sha256:…"
  }
}
```

Rules:

- `command` is the redacted argv supplied by the audit/evidence boundary, not
  hand-assembled text. `commandHash` covers its normalized safe form.
- `connectionName` and `environment` use the resolved runtime identity already
  recorded in audit metadata; endpoints and credentials never appear.
- Schema and semantic fingerprints identify the filtered, visible state used at
  execution. A missing semantic file is represented explicitly as `null`, not
  as an empty fingerprint.
- `observation` contains a bounded safe fingerprint or outcome summary, never
  rows, scalar values, column values, raw query text, or an error body.
- A receipt is **not** a promise that the command can be replayed elsewhere.
  ADR-0004's connection/config reproducibility limitation remains visible in
  the receipt's `replay` metadata.

### 6.3 Evidence-pack contract

An `EvidencePack` has a versioned persisted form. `integrity.digest` is the
SHA-256 of canonical UTF-8 serialization of the object with the digest omitted;
it detects accidental or malicious modification after creation but is not a
signature and proves no authorship:

```json
{
  "version": 1,
  "id": "evp_…",
  "createdAt": "2026-08-08T00:00:00.000Z",
  "subject": { "kind": "migration", "name": "add-orders-index" },
  "claims": [
    {
      "id": "claim-1",
      "text": "The proposed migration has a passing read-only verification artifact.",
      "evidence": [
        { "kind": "receipt", "ref": "…" },
        { "kind": "verification-artifact", "ref": "…" }
      ]
    }
  ],
  "coverage": {
    "completeForDeclaredEvidence": true,
    "gaps": []
  },
  "integrity": { "algorithm": "sha256", "digest": "…" }
}
```

The claim's text is untrusted external input. `evidence validate` may establish
that every reference exists, matches its context, and is safe to show; it cannot
and must not label the claim as supported, disproved, or verified. `coverage`
describes pack completeness relative to its declared references only.

### 6.4 Commands and delivery slices

Slice E1 is offline composition over **existing** verification artifacts and
audit references. It intentionally produces no query result receipt yet. The
claims input is an object with a bounded `subject` and a non-empty `claims`
array; each claim contains only `id` and `text`. `compose` resolves and writes
the evidence references into the resulting pack:

```text
dbcli evidence compose --claims <file> --verification <selector>... \
  [--audit <id>...] --output <path> --format json|markdown
dbcli evidence validate --file <path> --format json|markdown
dbcli evidence render --file <path> --format json|markdown
```

`compose` is the only writer and requires `--output`; that output is always the
canonical JSON artifact. `--format` controls the stdout summary. `validate` and
`render` are offline/read-only. At composition time, every explicitly selected
verification, audit, or recovery reference is required: a missing, malformed,
foreign, unsafe, disabled, or unavailable source causes a non-zero failure and
no pack is written. `validate` also recomputes the pack digest. If a
previously-resolved external reference later disappears through audit rotation
or clear, parsing/digest validation can still succeed but reference validation
reports a `source-expired` coverage gap and exits non-zero; rendering remains
available for forensic review. This distinction prevents a historic pack from
being rewritten while never presenting unavailable provenance as valid.

Slice E2 adds explicit receipt emission to existing bounded operations, starting
with `assert` and `verify`; query/explain receipts require their own security
review before inclusion:

```text
dbcli assert … --evidence-receipt <path>
dbcli verify … --evidence-receipt <path>
```

Receipt writing shares one core builder and the established audit redaction
logic. It is not a generic command wrapper and never executes another command.

### 6.5 Acceptance criteria

1. Composing and validating a pack needs no database connection and cannot
   execute a query, task step, or verification scenario.
2. Packs with missing/invalid references, unknown keys, overlong claim text,
   or a blacklisted identifier in an exposed field fail closed.
3. Every successful receipt reference can be joined to an existing audit or
   verification artifact without copying its sensitive payload.
4. Markdown rendering prominently labels claims as externally authored and
   distinguishes them from dbcli observations and verification status.
5. Tests prove deterministic parsing/rendering, digest verification, path
   containment, redaction, reference mismatch, stale context, and the absence
   of rows/raw SQL from all output formats.

## 7. Capability B — semantic contracts

### 7.1 Outcome

Teams can commit a small, reviewable layer of business definitions that tells
an agent what a domain term means and what evidence is expected before it uses
that term in a change or handoff. This is an extension of semantic context, not
another “data contract” product.

The canonical term is **semantic contract** to avoid colliding with schema,
Kafka, or API contract terminology.

### 7.2 Separate contract artifact

Contracts are a peer, versioned artifact rather than a version bump that makes
the strict semantic context carry stewardship and evidence lifecycle concerns.
The default committable file is `dbcli.contracts.json`:

```json
{
  "contracts": [
    {
      "name": "active-customer",
      "status": "approved",
      "description": "A customer with at least one paid order in the trailing 30 days.",
      "subjects": ["model:customers", "metric:paid-orders-30d"],
      "owner": "growth",
      "evidencePolicy": "verification-required"
    }
  ],
  "version": 1
}
```

Validation rules:

1. Contract names are unique, bounded canonical identifiers. `subjects` are
   unique canonical semantic references accepted by the existing registry.
2. `status` is exactly `draft`, `approved`, or `deprecated`. Only `approved`
   contracts may be included in ordinary `skill context`; direct contract
   inspection of other statuses is explicit and local.
3. `owner`, descriptions, and aliases are bounded plain text. They contain no
   SQL, data examples, credentials, permissions, blacklist rules, or raw
   identifiers outside canonical references.
4. `evidencePolicy` is descriptive and restricted to `none`,
   `receipt-required`, or `verification-required`. It does not execute a query
   and does not create a user-defined verification scenario.
5. The contract parser consumes a valid semantic context but does not change
   it. Absent `dbcli.contracts.json` is valid and produces no contracts; no
   guessing or automatic approval is allowed.

`contract drift` reports a contract as stale whenever one of its referenced
semantic entities becomes invalid or hidden by the existing filtered-schema
rules. A stale contract is omitted from normal agent context. The contracts
module delegates semantic-reference and filtered-schema validation to the
semantic module; it never reconstructs that boundary itself.

### 7.3 Commands

The dedicated command family keeps the ownership explicit:

```text
dbcli contract validate [--file <path>] [--format text|json]
dbcli contract context [--file <path>] [--format json|markdown]
dbcli contract search <terms...> [--format text|json]
dbcli contract drift [--file <path>] [--format text|json]
```

No `contract run`, `evaluate`, `generate`, migrator, or provider command is
introduced in v1. The first artifact is authored and reviewed like the existing
semantic file. A later evaluation capability must use an explicit observation
or verification artifact; it cannot make a user-defined verify scenario.

### 7.4 Acceptance criteria

1. Existing semantic formats and commands remain unchanged. The independent
   contract artifact validates and sorts deterministically offline.
2. Unknown, stale, duplicate, noncanonical, or blacklisted references fail
   closed and do not reveal the protected identifier in normal agent output.
3. An approved contract is discoverable through contract context/search and may
   be included in `skill context`; draft and deprecated contracts cannot
   silently influence an agent's ordinary context.
4. The contract cannot create execution authority or bypass `QueryDraft`,
   permission, blacklist, or verify-scenario gates.
5. Tests cover status visibility, schema/saved-query drift, blacklist filtering,
   validation/rendering, and four-way user-document parity when behavior is
   implemented.

## 8. Capability C — change impact assessments

### 8.1 Outcome

Before an agent labels a schema/design change as safe, dbcli produces a
deterministic report of what its known sources say is affected and what is not
known. The report is useful in PR review and CI, but is advisory unless a known
hard break is discovered.

### 8.2 Inputs and coverage model

The assessment starts from one explicit proposed physical change, normally a
normalized `dbcli design diff` against the local cache or a supported ORM. It
then joins the following optional, bounded evidence sources:

| Input | What it can establish | Gap when unavailable |
| --- | --- | --- |
| Design/schema diff | added, removed, or modified physical objects | Cannot assess a change that was not represented in the input diff |
| Semantic context/contracts | governed model/field/metric/contract references | No business-vocabulary impact assessment |
| Saved-query metadata | named saved-query references, not SQL body exposure | No proof for ad-hoc queries |
| Built-in verification metadata | affected declared assertions/scenarios | No assertion of post-change correctness |
| Proxy/querylens events | recently observed fingerprints/tables, advisory only | No runtime-workload evidence; historical logs are never assumed complete |
| Data access manifest | explicitly declared code-to-data references | Unknown dynamic SQL/ORM behavior and undeclared code paths |

Every report contains `coverage.sources[]`, `coverage.gaps[]`, and an explicit
`coverage.level` of `partial` or `declared`. v1 never emits `complete`.

### 8.3 Data access manifest

`dbcli.data-access.json` is an optional, project-committable declaration. It is
not automatically generated and not asserted to be exhaustive. Its purpose is
to let a project review named data-access paths before dbcli eventually ships
narrow source integrations based on real demand.

```json
{
  "version": 1,
  "operations": [
    {
      "name": "orders.list-for-customer",
      "source": "src/orders/repository.ts",
      "kind": "read",
      "references": ["model:orders", "field:orders.customer_id"],
      "coverage": "declared"
    }
  ]
}
```

The parser validates only bounded shape, relative workspace-contained `source`
paths, canonical semantic references, and unique names. It does not read or
parse application source in v1. `coverage: "declared"` is mandatory in every
operation so an agent cannot mistake a manually maintained manifest for static
analysis.

### 8.4 Core report and command

`src/core/impact` accepts normalized input objects and produces sorted findings:

```text
assessImpact(input) -> {
  findings: ImpactFinding[]
  coverage: ImpactCoverage
  recommendedVerification: VerificationRecommendation[]
}
```

Finding codes are stable and initially limited to:

- `REMOVED_OR_CHANGED_SEMANTIC_REFERENCE` — error;
- `STALE_CONTRACT` — error;
- `AFFECTED_SAVED_QUERY` — error when its approved reference is removed,
  warning when only workload evidence exists;
- `AFFECTED_DECLARED_ACCESS_OPERATION` — warning;
- `AFFECTED_OBSERVED_WORKLOAD` — warning;
- `MISSING_VERIFICATION_EVIDENCE` — warning;
- `COVERAGE_GAP` — warning.

The first command surface is deliberately tied to existing physical design
inputs:

```text
dbcli impact assess --design <file> (--against-cache | --against-orm <path>) \
  [--access-manifest <file>] [--events <path>] \
  [--format json|markdown] [--output <path>] [--fail-on error|warn|never]
```

The command performs no database connection, schema refresh, SQL execution, or
file write unless `--output` was supplied. `--fail-on error` is the default;
`warn` is appropriate for an intentionally strict CI gate. `--output` must be
workspace-contained unless a future explicit external-output policy is added.

### 8.5 Acceptance criteria

1. Given the same design diff, semantic context, saved-query metadata,
   manifest, and event file, output ordering, finding codes, and exit status
   are deterministic.
2. A removed physical field correctly identifies all visible governed semantic
   references and contract references, without exposing blacklisted names.
3. Missing context, event logs, manifest, verification source, or unreadable
   input produces an explicit coverage gap; it cannot yield a clean report.
4. The command never parses arbitrary application code, runs migrations,
   creates indexes, calls a provider, or reads database rows.
5. `--fail-on` alters only the process exit decision; it never removes a
   finding from JSON or Markdown output.
6. Tests cover each finding, unknown/blacklisted references, path traversal,
   dynamic-code coverage limits, event redaction, deterministic output, and
   focused CLI exit semantics.

## 9. Delivery sequence

Each slice remains independently useful and leaves a working product.

| Order | Slice | Deliverable | Why now |
| --- | --- | --- | --- |
| 0 | ADI-00 | This specification, glossary, threat review, fixtures | Fix language and non-goals before public contracts |
| 1 | ADI-01 | Offline evidence compose/validate/render over existing verification and audit references | Smallest new product loop; reuses stable artifacts without new execution capture |
| 2 | ADI-02 | Separate contract v1, drift/search/context handling | Turns team knowledge into governed, reviewable input for evidence and impact without destabilizing semantic context |
| 3 | ADI-03 | Offline impact assessment from design diff, semantic context, saved-query and verification metadata | Produces immediate PR/CI value without pretending to parse all code |
| 4 | ADI-04 | Optional manifest and bounded proxy/workload adapters | Adds code/runtime signals while making coverage limits explicit |
| 5 | ADI-05 | Assert/verify evidence receipts | Strengthens evidence provenance after E1's compositional contract is stable |

Query/explain receipts, source-code integrations (for example Prisma or
Drizzle), and automatic CI adapters are separate follow-ups. Each needs a
demonstrated user workflow and a design that preserves the execution-path
contract; none is implied by this specification.

## 10. Cross-cutting testing, documentation, and release rules

Every implementation slice must include:

1. unit tests for the deep module's parser, normalizer, deterministic ordering,
   redaction, bounds, and failure modes;
2. command/integration tests for offline behavior, explicit-output-only writes,
   JSON/Markdown contracts, error exit code, and path containment;
3. adversarial tests proving no raw rows, raw SQL, credentials, blacklisted
   identifiers, or unauthorized command execution escape through artifacts;
4. appropriate execution-path-contract tests if receipt capture touches a
   command that reaches an adapter;
5. the four synchronized user documents and generated skill/platform checks
   whenever command behavior becomes public;
6. `bun run typecheck`, `bun run lint`, focused `bun test`, then the
   proportionate broader suite and final diff review.

The schema of persisted evidence/contract/manifest formats is versioned. A
breaking change needs a deterministic read migration or a clear reject path;
there is no heuristic compatibility behavior.

## 11. Open decisions and re-gates

| Decision | Current answer | Reopen when |
| --- | --- | --- |
| Persist query/explain receipts | Deferred beyond assert/verify receipts | A concrete investigation workflow needs them and an adversarial redaction review passes |
| Add a public verification DSL | No | Existing production-soak, release, and demand gates in the verify-scenario decision all pass |
| Parse application source automatically | No | A named ORM/query library has repeated demand and can be modeled as a narrow, tested adapter |
| Treat workload events as blocking | No, advisory only | A project declares retention/freshness/coverage policy that makes the signal meaningful |
| Add provider-generated contracts/claims | No | An explicit data-egress/retention/provider decision is approved independently |

## 12. Rollback

All new artifacts are additive and versioned. Removing an implementation slice
does not change database state or existing audit/verification records. A team
can stop committing semantic contracts or a data-access manifest by deleting
those optional files; absence produces an explicit coverage gap rather than
fallback behavior. Locally written evidence artifacts can be removed under the
project's normal local-state policy.
