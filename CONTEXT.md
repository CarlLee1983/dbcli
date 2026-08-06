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
