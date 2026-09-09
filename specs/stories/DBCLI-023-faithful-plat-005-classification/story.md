# Story: DBCLI-023 A Classification That Matches Its Own Story

## Goal

DBCLI-PLAT-005 declares what it actually is and describes the boundary its code
actually has, so the second of the admitted contract exemptions is deleted and
the last Classification contradiction in the repository is gone.

## Context

DBCLI-022 removed the first exemption. PLAT-005 is the second, and the only one
of the five carrying two different kinds of finding:

* `every trust-boundary field must name an exact field, not prose` — the same
  shape DBCLI-022 fixed. One of four bullets, `Serialized stdout bytes — must
  never exceed 65,536 UTF-8 bytes`, is not a field.
* `Story declares Baseline conformance: no but declares superseded behavior` —
  upstream's R8: a Story declaring `no` must not carry the matching section.

The second is a contradiction, not a wording problem, and it has two exits: flip
the declaration, or delete the section. They are not equivalent — one keeps a
true record, the other destroys it.

**The section is true and the declaration is wrong.** PLAT-005's
`## Superseded Behavior` names two behaviors PLAT-004 established and PLAT-005
deliberately replaced: `operation` constrained to `capabilities.check` alone,
and `dbcli --agent-output capabilities` rejected as an unsupported operation.
Both are accurate, and both are exactly what the section is for — upstream's
template asks for "each existing test or documented behavior this Story
intentionally replaces".

The declaration is the half that does not survive comparison with its siblings.
Four Stories in this repository already declare `Baseline conformance: yes` for
this same shape — a change Story that supersedes named prior behavior, not a
conformance audit: DBCLI-017 (the `make verify` step roster), DBCLI-020 (the
nineteen absolute-time perf cases), DBCLI-PLAT-011 (documentation sentences that
become wrong on delivery) and DBCLI-PLAT-012. Reading PLAT-005 as `no` would
make it the only Story of that shape declaring the opposite.

So the correction is one word, and it preserves both halves of a record a human
already accepted. Deleting the section would have satisfied the same checker
while losing the only written statement of what PLAT-005 replaced.

Re-deriving the trust-boundary section found the remaining declarations thin
rather than wrong. `capabilities.list` answers from `buildCapabilityCatalog()`,
which returns the frozen `CAPABILITIES` table; `src/core/capabilities/` reads no
environment variable, file or dynamic import at all — asserted over its whole
import graph — which is why that operation emits `context: null` and needs no
configuration. The old section stated that as
a requirement the catalog "must" meet. It is a property the code already has.

## Classification

* Security sensitive: no
* Baseline conformance: no

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: low

## Risk

* Level: medium
* Reason: `classification-flip`

Changing a Classification changes which sections upstream requires of the
Story and what a reader takes the Story to be. The failure mode is picking the
exit that silences the checker fastest rather than the one that keeps the
record true.

## Scope

### In Scope

* Correcting `Baseline conformance` to `yes` in
  `specs/stories/DBCLI-PLAT-005-agent-json-mode/story.md`, leaving its
  `## Superseded Behavior` entries as written.
* Rewriting that Story's `## Trust Boundary Fields` so every bullet names an
  exact field, split by whether the value enters from `argv` or through
  `parseOperationEnvelope(unknown)`, each backed by named code.
* Deleting the `DBCLI-PLAT-005-agent-json-mode` entry from `PREDATING_FINDINGS`
  and lowering both counts to what remains.

### Out of Scope

* PLAT-006, PLAT-007 and PLAT-012. Sixteen of their eighteen remaining findings
  are security-fixture cells whose real values must be re-derived from the code;
  that is its own Story, and PLAT-004's and PLAT-005's removals do not make it
  smaller.
* `specs/stories/DBCLI-PLAT-005-agent-json-mode/acceptance.md`. The
  Classification change does not alter any acceptance criterion, and every field
  the rewritten section names already has one.
* Any change to `src/` or to product behavior. This releases nothing.
* Relaxing, renaming or adding any other exemption, and any edit to upstream's
  checkers.

## Inputs

* Upstream ForgeFlow at the adopted revision `cb4bc976`.
* `src/commands/capabilities.ts`, `src/core/capabilities/registry.ts`,
  `src/core/capabilities/schema.ts`, `src/utils/agent-output.ts` and
  `src/core/operation-envelope.ts` — the code the declarations must be true of.

## Outputs

* A PLAT-005 Story upstream `story-check` reports no finding against.
* Eighteen admitted findings across three Stories, down from twenty across four.

## Rules

* R1: The Classification is corrected to what the Story is, not to whichever
  value makes the checker quiet. `## Superseded Behavior` keeps its entries.
* R2: Every bullet under PLAT-005's `## Trust Boundary Fields` names an exact
  field and is true of the code at this revision.
* R3: No constraint stated by the old section is dropped without being stated
  elsewhere. The 65,536-byte cap remains a rule of the envelope contract.
* R4: `ADMITTED_FINDINGS` and `ADMITTED_STORIES` equal what
  `PREDATING_FINDINGS` holds, and both only decrease.
* R5: No exemption other than PLAT-005's is added, removed, renamed or
  broadened, and the repository ships no product change.

## Expected Errors

* A declaration left at `no` beside the section keeps upstream's contradiction
  finding, and the gate then fails on it as unadmitted.
* A stale count fails `tests/unit/scripts/forgeflow-contract.test.ts` before the
  gate is reached.

## Dependencies

* `scripts/lib/forgeflow-contract.ts` — the exemption list and its two counts.
* `tests/unit/scripts/forgeflow-contract.test.ts` — the ratchet assertions.
* DBCLI-022 — the first removal, and the precedent for re-deriving rather than
  backticking.

## Constraints

* `bun run forgeflow:contract` is not part of `make verify`; both must pass.
* The upstream checker runs from a clean checkout at exactly `cb4bc976`.
