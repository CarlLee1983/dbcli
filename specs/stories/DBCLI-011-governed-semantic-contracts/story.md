# Story: DBCLI-011 Governed Semantic Contracts

## Goal

Let reviewers and agents use a locally reviewed definition for a governed
business term without treating a field name as its meaning or expanding the
contract workflow into database execution.

## Context

The semantic-contracts guide describes a versioned `dbcli.contracts.json`
beside semantic evidence. A contract records its canonical name, subject,
owner, evidence policy, and review status so a business term has a source that
can be inspected before a change is reviewed.

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

* Validate, inspect, search, and assess drift for the optional local contract
  artifact.
* Surface only valid `approved` contracts in ordinary agent context.
* Preserve bounded local evidence for invalid, stale, unavailable, draft, and
  deprecated contract states.
* Add regression coverage and keep English and Traditional Chinese user
  documentation, Markdown, and HTML guidance aligned.

### Out of Scope

* Executing SQL, connecting to a database, or generating a provider request.
* Contract expressions, executable rules, credentials, protected identifiers,
  or SQL in contract content.
* Automatically approving a contract or resolving a business definition.
* Schema-change impact analysis beyond reporting contract drift.

## Inputs

* Optional versioned `dbcli.contracts.json` and local semantic evidence.
* A requested contract name or search term where applicable.

## Outputs

* Deterministic validation, context, search, or drift evidence suitable for
  review.
* A bounded, actionable error or state when requested local contract evidence
  is missing or invalid.

## Rules

* R1: Contract artifacts use version `1`, canonical names, status `draft`,
  `approved`, or `deprecated`, evidence policy `none`, `receipt-required`, or
  `verification-required`, and subjects using only `model:`, `field:`,
  `relationship:`, or `metric:`.
* R2: Only valid `approved` contracts may enter ordinary context; draft and
  deprecated contracts remain local review artifacts.
* R3: A missing optional contract file leaves ordinary semantic context
  unchanged; an explicitly requested missing or invalid artifact fails closed.
* R4: Contract commands are offline and read-only. They must not create an
  adapter, connect, execute queries, or modify an artifact.
* R5: Invalid evidence reports bounded diagnostics without reproducing arbitrary
  input values or protected content.
* R6: Contract content must reject executable or sensitive material, including
  SQL, credentials, and protected identifiers.

## Expected Errors

* An explicitly requested missing or invalid contract artifact returns bounded,
  actionable local evidence and does not produce ordinary contract context.

## Dependencies

* Existing semantic metadata and local contract validation/context surfaces.
* DBCLI-008 Offline Impact Assessment may consume approved contract evidence;
  it remains a separate Story.

## Constraints

* Preserve the offline, non-executable safety boundary.
* Do not add dependencies or broaden database permissions.
* Use focused tests first and `make verify` as the completion gate.

## Superseded Behavior

* `tests/unit/core/contracts/contracts.test.ts` — its validation, status, and
  evidence-policy assertions are the baseline; this Story's R1, R2, and R6
  take precedence where an accepted/rejected contract field differs.
* `tests/unit/commands/contracts.test.ts` — its inspect/search/drift command
  assertions are the baseline; R2–R5 take precedence where a command's
  offline/read-only or context-filtering outcome differs.
* `docs/guides/en/semantic-contracts.html` — its published contract-review
  narrative is the baseline; this Story's Rules take precedence where a
  documented step or boundary differs.
* `docs/user/en/index.md` and `docs/user/zh-TW/index.md` — their existing
  semantic-contract usage descriptions are the baseline; this Story's Rules
  take precedence where documented behavior differs.
