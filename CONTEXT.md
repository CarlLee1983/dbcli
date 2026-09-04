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

## Agent integration language

**Capability**:
One atomic dbcli ability with a stable dotted id — `schema.read`,
`data.delete`. It names what the *tool* can do. A job or a method
(`dba.tune-production`, `crud.scaffold`) is not a capability; it belongs to the
Role Skill or Method Skill that composes dbcli.

**Capability catalog**:
The complete, versioned, statically known set of capabilities. It is derived
from the engine capability matrix rather than declared beside it, so it cannot
claim engine support the matrix does not grant. Reading it requires no database
connection.

**Capability contract version**:
`CAPABILITY_CONTRACT_SCHEMA_VERSION`. It moves when the catalog's shape
changes and never because the npm package version moved, following the same
rule as the evidence artifact versions.

**Discovery**:
Answering "what can this tool do". It is not a permission grant: a capability
appearing in the catalog says the binary is able to do it, not that anyone may.

**Capability availability**:
Whether the *locally configured* engine, agent mode and permission would refuse
a capability — `available`, `unavailable`, or `unknown`. It is a statement about
this machine's configuration, evaluated without connecting to a database. It is
distinct from approval: blacklist, write gate, confirmation and audit all still
run at execution time, and human consent is not modelled at all. `admin` in a
config file is a permission level, not a DBA sign-off.

**Context unavailable**:
There is no local configuration here, so availability could not be established.
It is neither `available` nor `unknown`: the requirement was understood, the
environment was not. The default configuration is never reported as though it
were configured.

**Context unresolvable**:
A configuration exists and could not be turned into an engine and a permission
— an `{"$env": "..."}` reference naming an unset variable, for instance. It is
a different fact from *context unavailable*, and reporting it as one would
state something false about the machine. Both fail closed.

**Environment gate**:
A refusal decided before execution and knowable without connecting — agent
mode is the only one today. It is distinct from an execution-time gate
(blacklist, write gate, confirmation, audit), which capability availability
deliberately does not speak for. The dividing line is *when* the refusal is
decided: what is decidable here is the contract's responsibility to report.

## Skill layering

**Tool** (`dbcli`):
What can be done at all.

**Tool Skill** (the dbcli Skill):
How to operate dbcli safely.

**Method Skill**:
How a method of working proceeds — CQRS, event sourcing, migration practice.

**Role Skill**:
How a job proceeds — DBA operations, CRUD engineering, review.

**Project governance** (`AGENTS.md`):
Which Skills apply here, how they are routed, and where the permission
boundaries lie.

Role, Method and project knowledge never enter dbcli core. dbcli answers only
for the first two layers.
