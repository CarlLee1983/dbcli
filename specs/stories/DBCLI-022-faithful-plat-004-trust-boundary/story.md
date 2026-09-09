# Story: DBCLI-022 A Trust Boundary Declaration That Names Fields

## Goal

DBCLI-PLAT-004's `## Trust Boundary Fields` says what the code actually does, so
that the first of the five admitted contract exemptions is deleted rather than
carried, and the ratchet is shown to turn.

## Context

DBCLI-018 had CI run upstream ForgeFlow's own checkers against this
repository's Stories (ADR-0027). Five delivered Stories failed on twenty-one
findings that predate the gate; they failed identically under 0.3.2 and nothing
had run the checker, so nobody knew. The findings are admitted per Story in
`PREDATING_FINDINGS`, exactly as upstream states them, so that they are bounded
rather than tolerated — a list that may shrink and never grow.

Nothing had shrunk it yet. This Story is the first entry removed, and the
smallest: DBCLI-PLAT-004 carries one finding,
`every trust-boundary field must name an exact field, not prose`.

Upstream's rule is that every bullet under `## Trust Boundary Fields` contains a
non-empty backticked span (`forgeflow_count_literal_bullets` and
`forgeflow_has_literal` in `scripts/story-check`). Exactly one of PLAT-004's ten
bullets does not: `Serialized stdout bytes — final 65,536-byte limit and
single-document framing`. Satisfying the checker by putting backticks around
that sentence is available and refused. It is not a field; the section's own
template asks for "every user-controlled or externally derived field", and the
byte cap and single-document framing are already stated as rules R12, R13 and
R14 and asserted in acceptance.

Re-deriving the section against the code found two declarations that were not
merely imprecise:

* **`warnings[].message` is not curated text.** It reads "derived diagnostic
  vocabulary and curated English text", but
  `Duplicate capability id '${id}' in --require was ignored.`
  (`src/core/capabilities/check.ts:70`) interpolates the id the user typed. It
  is safe for a different reason than the one declared — every id has already
  matched `CAPABILITY_ID_PATTERN` and the 160-character cap in
  `validAgentRequirements` (`src/commands/capabilities.ts:129-138`) before a
  warning can reach the envelope.
* **`evidence[]` and `recovery` are never populated by this Story.**
  `toAgentEnvelope` and `createAgentOutputFailure` emit `evidence: []` and
  `recovery: null` unconditionally (`src/commands/capabilities.ts:158-176`,
  `src/utils/agent-output.ts:187-203`). They cross a boundary only inside
  `parseOperationEnvelope(unknown)`, which is exported through
  `@carllee1983/dbcli/core` and reads a document from a producer it does not
  control. Listing them beside `argv` implied dbcli produces them.

That second point is why the section is now split by boundary rather than
flattened into one list. The two boundaries constrain the same field names for
different reasons, and a reader who cannot tell them apart cannot tell which
fields dbcli is responsible for bounding.

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: mixed

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: yes
* deploy: no

## Architecture

* Impact: low

## Risk

* Level: medium
* Reason: `security-declaration`

Editing a security declaration a human has already accepted is a change to the
record. The failure mode is a declaration rewritten to please a checker while
saying less than the one it replaced, which is the opposite of what the gate
exists for.

## Scope

### In Scope

* Rewriting `## Trust Boundary Fields` in
  `specs/stories/DBCLI-PLAT-004-operation-envelope-v1/story.md` so that every
  bullet names an exact field, grouped by which boundary the value crosses,
  each declaration backed by named code or a named test.
* Deleting the `DBCLI-PLAT-004-operation-envelope-v1` entry from
  `PREDATING_FINDINGS` and lowering `ADMITTED_FINDINGS` and
  `ADMITTED_STORIES` to match what remains.
* Bringing the reasoning in `scripts/lib/forgeflow-contract.ts` to match the
  list it explains.

### Out of Scope

* The other four admitted Stories. Each is its own removal; PLAT-006 and
  PLAT-007 need sixteen security-fixture cells re-derived from the code, which
  is not this Story.
* Any change to `src/`, to product behavior, or to a published version. This is
  a governance correction and releases nothing.
* `specs/stories/DBCLI-PLAT-004-operation-envelope-v1/acceptance.md`. Every
  field the rewritten section names already has an accepted acceptance
  criterion and a cited test; rewriting accepted acceptance text to restate
  them would change the record without adding a check.
* Relaxing, renaming or adding any other exemption, and any edit to upstream's
  checkers.
* Turning on `story-check --ready`, out of scope for the reason ADR-0027 gives.

## Inputs

* Upstream ForgeFlow at the adopted revision `cb4bc976`, run as
  `FORGEFLOW_ROOT=<checkout> bun run forgeflow:contract`.
* `src/core/operation-envelope.ts`, `src/utils/agent-output.ts`,
  `src/commands/capabilities.ts`, and `src/commands/capability-context.ts` —
  the code each declaration must be true of.

## Outputs

* A PLAT-004 Story upstream `story-check` reports no finding against.
* Twenty admitted findings across four Stories, down from twenty-one across
  five.

## Rules

* R1: Every bullet under PLAT-004's `## Trust Boundary Fields` names an exact
  field and is true of the code at this revision. A backtick added to prose to
  satisfy the checker fails this rule even though it passes the checker.
* R2: No trust-boundary constraint stated by the old section is dropped without
  being stated elsewhere in the Story. The 65,536-byte cap and single-document
  framing remain R12, R13 and R14.
* R3: `ADMITTED_FINDINGS` and `ADMITTED_STORIES` equal what
  `PREDATING_FINDINGS` actually holds, and both only decrease.
* R4: No exemption other than PLAT-004's is added, removed, renamed or
  broadened.
* R5: The repository ships no product change. `src/` is untouched.

## Expected Errors

* A PLAT-004 bullet still written as prose keeps the upstream finding, and the
  gate then fails on the deleted exemption as a finding it has not admitted.
* A stale count fails `tests/unit/scripts/forgeflow-contract.test.ts` before
  the gate is reached.
* An exemption deleted for a finding upstream still reports fails as a new
  finding, not silently.

## Dependencies

* `scripts/lib/forgeflow-contract.ts` — the exemption list and its two counts.
* `tests/unit/scripts/forgeflow-contract.test.ts` — the ratchet assertions.
* ADR-0027 — upstream's checkers are run, not reimplemented.

## Constraints

* `bun run forgeflow:contract` is not part of `make verify`; both must be run
  and both must pass.
* The upstream checker is run from a clean checkout at exactly `cb4bc976`. A
  dirty checkout is at no revision and the gate refuses it.
