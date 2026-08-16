# Documentation Governance Context

This context defines the project's language for planning, recording, and proving
software changes. It keeps current behavior, product contracts, historical
decisions, and completion state from being conflated.

## Language

**Source of truth**:
The scoped authority for a particular question. Behavior, product contracts,
decision rationale, and completion state may each have different authorities.

**Implementation plan**:
A bounded document that turns a decided design into work, acceptance, and
verification. It is not a permanent behavior contract.

**Design record**:
A historical record of intent, trade-offs, and deviations. It is not a task
list.

**Completion evidence**:
Bounded proof that an outcome meets its acceptance criteria, including the
relevant changes, tests, documentation checks, and known risks.

**Deferred decision**:
An intentionally postponed choice with an explicit condition for reopening it;
it is not an unspecified future TODO.

**Known deviation**:
A named part of delivered work that intentionally does not satisfy its own
acceptance criterion, recorded with what it deviates from and what would make
it worth revisiting. It is neither a TODO nor an unreported defect: work
carrying one is delivered, not complete.

**Unverified**:
An acceptance criterion whose implementation exists but which no test asserts.
It is a statement about proof, not about correctness, and it is distinct from a
known deviation: nobody has decided the criterion is unmet, nobody has shown it
is met. A partially asserted criterion is unverified, not covered.

## Semantic query-drafting language

**QueryDraft**:
An explicit, unexecuted candidate saved-query reference or read-only SQL
artifact. It is untrusted input until the offline draft validator accepts it;
acceptance never grants execution permission.

**Draft validator**:
The deterministic, local boundary that checks a `QueryDraft` against the
governed semantic context and existing SQL safety rules. It neither calls a
model nor executes SQL.

**Agent-driven drafting**:
An external agent creates a `QueryDraft` and submits it to dbcli for local
validation. The agent's provider choice, credentials, and model context remain
outside dbcli.

**Provider-driven drafting**:
dbcli explicitly calls an approved provider to create a `QueryDraft`. It is a
separate, policy-gated transport concern and uses the same validator; it is not
a different permission tier.

## Agent data-work language

**Evidence receipt**:
A bounded, machine-readable record of one explicit dbcli operation. It proves
what dbcli observed or verified under a particular governed context; it never
contains database rows, unredacted SQL, credentials, or an agent's conclusion.

**Evidence pack**:
A reviewable collection that connects one or more human- or agent-authored
claims to evidence receipts, verification artifacts, and audit references. A
pack makes provenance inspectable; it does not make a claim true.

**Claim**:
Bounded human- or agent-authored text in an evidence pack. It is untrusted
interpretation, not a dbcli verification verdict or executable assertion.

**Semantic contract**:
An approved, version-controlled business definition whose references are
validated against the governed semantic context. It is not a database-schema
contract, a permission rule, or executable SQL.

**Data subject**:
A stable, connection-scoped identity for a governed physical or semantic
object. It is not an unqualified table name that can collide across connections.

**Impact assessment**:
A deterministic report of known effects of a proposed schema/design change on
governed semantic references, saved queries, verification evidence, observed
workload, and explicitly declared code access. It reports the limits of its
coverage rather than claiming to find every application dependency.

**Coverage gap**:
An explicit statement that an impact assessment lacks a source needed to rule
out an effect. It is a warning, never a clean result.

## Outcome vocabularies

Three vocabularies describe how something turned out. They are not
interchangeable, and none of them may be mapped onto another.

**Verification status**:
The verdict a verification artifact records about its subject — `verified`,
`not_verified`, `indeterminate`, or `blocked`. Alone among the three it is a
judgment about the database, and it is part of a published JSON contract.

**Report finding**:
How one diagnostic snippet in a report snapshot turned out — `ok`, `no-data`,
`skipped`, `error`, or `timeout`. It says whether a diagnostic ran, not whether
anything was verified.

**Workload source**:
Whether an explicit proxy event file offered to an impact assessment could be
used — `available`, `absent`, `invalid`, or `unavailable`. It describes the
source, not a finding about the database, and it is always advisory.
