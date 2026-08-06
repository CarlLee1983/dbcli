# Semantic Query-Draft Ticket Backlog

**Date:** 2026-08-06

**Status:** SQD-01 through SQD-04 completed; SQD-04 records a deferred policy
decision. Provider-driven tickets remain deferred until the ADR reopen trigger
is satisfied.

**Specification:**
[`semantic query-draft roadmap`](../specs/2026-08-06-wren-inspired-semantic-roadmap.md)

## Purpose

Split Slice 3 into independently reviewable tickets. Ticket IDs are local
planning identifiers, not GitHub issues. No ticket may make `QueryDraft`
execute SQL or bypass existing `explain` / `query` authorization gates.

## Dependency map

```text
SQD-01 QueryDraft contract + offline validator
  -> SQD-02 agent-driven CLI validation workflow
  -> SQD-03 agent documentation and end-to-end safety evidence

SQD-04 provider policy decision (separate approval)
  -> SQD-05 provider adapter boundary
  -> SQD-06 first provider-driven generate command
```

`SQD-04` does not depend on code completion, but it is a mandatory gate for
every provider-driven ticket. It currently records the deferred decision in
[ADR-0005](../adr/0005-provider-driven-query-drafts-remain-deferred.md).
`SQD-05` and `SQD-06` remain deferred until that ADR is superseded and a
separate implementation instruction is approved.

---

## SQD-01 — Define `QueryDraft` and the offline validator

**Status:** Completed (2026-08-06)

**Depends on:** Slice 1 and Slice 2 semantic context contracts

**Outcome:** Establish one versioned, deterministic TypeScript contract for an
untrusted query draft and a core validator that performs no I/O beyond its
explicit local inputs.

**Scope:**

- Define `QueryDraft`, candidate, canonical-reference, and validation-report
  types in the semantic deep module.
- Validate structural shape, version, hashes, canonical semantic references,
  saved-query names, read-only/single-statement SQL constraints, and filtered
  schema/blacklist compatibility.
- Return a stable report that contains hashes and safe evidence, never the
  candidate SQL body or protected names.
- Keep the core free of CLI parsing, provider SDKs, keys, network clients,
  database queries, or automatic file persistence.

**Non-goals:** A CLI command, LLM calls, SQL execution, provider selection, or
automatic repair/rewrite of a draft.

**Acceptance criteria:**

1. Equivalent valid inputs produce byte-stable JSON data after canonical
   serialization.
2. Malformed, multi-statement, write, unknown-reference, and blacklisted
   inputs fail closed with safe errors.
3. Tests prove no validator path reads query results, sends network traffic, or
   produces an executable command; candidate SQL used to exercise the parser is
   constructed in test code, never retained as a fixture.
4. Existing semantic context/search behavior remains unchanged.

**Verification:** Focused unit tests, `bun test`, `bun run typecheck`,
`bun run lint`, and `git diff --check`.

---

## SQD-02 — Expose the agent-driven draft validation command

**Status:** Completed (2026-08-06)

**Depends on:** SQD-01

**Outcome:** Let any external agent submit an explicit file or stdin payload to
the offline validator without teaching dbcli about the agent's provider or
credentials.

**Scope:**

- Add `dbcli semantic draft validate --input <file|-> [--format text|json]`.
- Define stable exit codes and text/JSON output for valid, invalid, and
  unavailable semantic context states.
- Do not echo the submitted SQL candidate, persist the input, dispatch an
  `explain` / `query`, or inspect provider configuration.
- Fail closed when required local semantic/schema evidence is unavailable.

**Non-goals:** Natural-language generation, interactive approval UI, automatic
execution, and any provider API integration.

**Acceptance criteria:**

1. A draft produced by Codex, Claude, or another external agent is handled
   identically when its JSON contract is identical.
2. JSON output contains only the validation report and safe metadata.
3. Command tests cover file and stdin input, non-zero rejection paths, output
   formats, unavailable context, blacklist handling, and proof of no execution.
4. All four user-document variants and generated skill artifacts describe the
   review-then-separate-execution workflow.

**Verification:** Focused command tests, then `bun test`, `bun run typecheck`,
`bun run lint`, `bun run docs:check`, `bun run skill:check`,
`bun run platform:check`, `bun run plugin:check`, `bun run contract:check`,
and `git diff --check`.

---

## SQD-03 — Publish agent-driven integration guidance and safety evidence

**Status:** Completed (2026-08-06)

**Depends on:** SQD-02

**Outcome:** Make the external-agent workflow easy to use without implying that
validation grants execution permission.

**Scope:**

- Add reviewed examples for creating a draft, validating it, reviewing it, and
  separately invoking existing `explain` or `query` commands.
- State the information boundary: agent-held provider credentials and context
  remain outside dbcli; dbcli validates only the explicit draft input.
- Add end-to-end regression coverage showing that no successful validation
  triggers database execution.

**Non-goals:** Bundled agents, agent authentication, provider credential
storage, or a new execution path.

**Acceptance criteria:**

1. Documentation is consistent in English and Traditional Chinese, Markdown
   and HTML, and generated skill artifacts.
2. Examples clearly distinguish `validate` from `explain` / `query`.
3. Tests assert that validation produces no audit execution event and no DB
   adapter call.

**Verification:** Relevant end-to-end tests plus the same repository-wide
checks as SQD-02.

---

## SQD-04 — Record provider-driven policy decision

**Status:** Completed — deferred decision recorded 2026-08-07

**Decision record:**
[`ADR-0005: Provider-driven query drafts remain deferred`](../adr/0005-provider-driven-query-drafts-remain-deferred.md)

**Depends on:** Explicit product and security approval to reopen; not on an
environment variable or an agent's logged-in state

**Outcome:** Produce a decision record that permits a bounded first provider or
keeps provider-driven generation deferred.

**Decision checklist:**

- Approved provider and model; supported regions and account ownership.
- Exact sanitized payload and explicit prohibitions on schema cache,
  saved-query SQL bodies, rows, credentials, blacklist entries, and local
  paths.
- Data egress, retention, training/use policy, and user consent model.
- API-key storage/rotation, cost/rate limits, error/retry behavior, and
  metadata-only audit retention.
- Offline behavior, provider revocation/rollback, and support ownership.

**Acceptance criteria:** The decision is recorded in an ADR or approved spec;
the Slice 3 roadmap and this backlog point to it; all unresolved checklist
items keep SQD-05 and SQD-06 blocked.

---

## SQD-05 — Build the provider adapter boundary

**Status:** Deferred

**Depends on:** SQD-01 and approved SQD-04 decision record

**Outcome:** Define a provider adapter that transforms only approved sanitized
input into a `QueryDraft`; it remains outside the semantic core.

**Scope:**

- One explicit provider-selection/configuration boundary with no implicit
  environment-based activation.
- Sanitized request construction and metadata-only response/audit handling.
- Provider-independent mapping into the SQD-01 `QueryDraft` contract, followed
  by the common validator.

**Non-goals:** Multiple providers by default, provider fallback, raw prompt or
response logging, query execution, or direct access to schema/data.

**Acceptance criteria:** Tests prove that the adapter receives only the
approved payload, requires explicit provider selection, and cannot return a
draft as validated until SQD-01 runs.

---

## SQD-06 — Deliver the first provider-driven generate command

**Status:** Deferred

**Depends on:** SQD-02, SQD-04, and SQD-05

**Outcome:** Add the explicitly approved
`dbcli semantic draft generate "<question>" --provider <provider>` command.

**Scope:**

- Implement only the provider/model authorized by SQD-04.
- Return a clearly marked `QueryDraft` plus safe provenance metadata, then run
  the common validator before reporting it as usable.
- Provide clear failures for missing authorization, configuration, network,
  quota, and invalid provider output.

**Non-goals:** Automatic fallback to another provider, silent egress, direct
`explain` / `query`, or changing the agent-driven workflow.

**Acceptance criteria:** The command cannot be invoked accidentally through
skill context, uses only approved outbound data, fails safely offline, and has
documented rollback that removes provider configuration without affecting
agent-driven validation.

**Verification:** Mocked transport/security tests, command tests, documentation
and generated-skill updates, then the repository-wide completion gate from the
semantic roadmap.
