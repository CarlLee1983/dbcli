# Story: DBCLI-021 Decision Records the Contract Can Resolve

## Goal

A Story that rests on an architecture decision says so in a line a checker
resolves, so that the link between a Story and the record explaining it is
verified rather than asserted in prose.

## Context

DBCLI-018 adopted ForgeFlow 0.6.0, which added four optional Story sections and
had CI run upstream's own checkers against them (ADR-0027). Three of the four
work here. `## Architecture` does not: its `Decision:` bullet resolved only
against `specs/decisions/`, a path with no configuration, while this repository
keeps its decisions in `docs/adr/`. DBCLI-020 needed that section — it changes
what `BlacklistValidator` exposes — and had to leave it out, saying so in prose
instead.

That was reported upstream (ForgeFlowV2 issue #23) and fixed in v0.7.0
(`cb4bc976`): `FORGEFLOW_DECISIONS_ROOT` names the directory, and leaving it
unset keeps the old default. Measured against this repository on 2026-09-09,
from checkouts of both tags:

* **The upgrade breaks nothing.** All 25 Story directories produce 21 findings
  under v0.6.0 and the same 21 under v0.7.0.
* **The variable works, and is not enough.** With `## Architecture` restored to
  DBCLI-020's Story and `FORGEFLOW_DECISIONS_ROOT=docs/adr`, upstream still
  reports `referenced decision record does not exist: ADR-0028`. The lookup is
  `<root>/ADR-0028.md` or `<root>/ADR-0028-*.md`; this repository's file is
  `0028-masking-cost-is-observable-without-a-clock.md`, with no `ADR-` prefix.
* **The id grammar is fixed too.** Referring to the record as `` `0028` ``
  instead fails with `architecture decision must be ADR-<digits>: 0028`.
  Upstream's 0.7.0 release notes name the decision filename grammar as
  deliberately out of scope, so this is a boundary rather than an omission.

So the remaining half is this repository's: the records are named in a form the
contract cannot resolve. Renaming them is mechanical and keeps them where they
are — one home for a decision and its rationale, which is the rule that ruled
out `specs/decisions/` in the first place.

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

* Impact: medium
* Decision: `ADR-0029`
* Boundary: `DecisionRecords`
* Contract: `every ADR is resolvable by the adopted ForgeFlow contract`
* Owner: `DecisionRecords = repository-governance`

## Risk

* Level: medium
* Reason: `rename-breaks-references`

A decision record whose link rots is a record nobody reads. The rename touches
every path reference in the repository, and a missed one is invisible until
somebody follows it.

## Scope

### In Scope

* Moving the adoption from 0.6.0 to 0.7.0 through `./scripts/bootstrap
  --upgrade`, pinned to the `v0.7.0` tag rather than to whichever checkout
  bootstrap ran from.
* Renaming every record in `docs/adr/` to `ADR-<digits>-<slug>.md`, with
  `git mv` so history follows, and updating every path reference to them.
* Setting `FORGEFLOW_DECISIONS_ROOT` where the contract check runs, so the
  variable is part of the check rather than something a caller must remember.
* This Story's own `## Architecture` section, which is the first one this
  repository can declare and therefore the proof that it works.

### Out of Scope

* Editing the text of Stories a human has already approved. DBCLI-020's Story
  explains in prose why it declared no `## Architecture`; that explanation was
  true when it was written and rewriting an approved record to tidy it up is
  not a documentation improvement.
* The 21 pre-existing findings. They are admitted per Story and unchanged by
  this upgrade.
* Turning on `story-check --ready`, which remains out of scope for the same
  reason ADR-0027 gives.

## Inputs

* ForgeFlow `v0.7.0`, commit `cb4bc976`.
* The 28 records in `docs/adr/` and the 34 path references to them.

## Outputs

* An adoption marker reading 0.7.0 at the tagged revision.
* Decision records the contract resolves, and one Story that proves it.

## Rules

* R1: The adoption version and revision are what upstream's tag says, not what
  a working checkout happened to contain.
* R2: Every renamed record is still reachable from every place that referenced
  it. A path reference that no longer resolves fails the build.
* R3: `bun run forgeflow:contract` resolves this Story's `Decision:` bullet
  without the caller setting anything by hand.
* R4: The number of admitted pre-existing findings does not grow.

## Expected Errors

* A `Decision:` bullet naming a record that does not exist fails the contract
  check.
* A path reference to a record's old name fails.

## Dependencies

* ForgeFlow `v0.7.0` published. It is: `cb4bc976`, tagged.

## Constraints

* The records stay in `docs/adr/`. Moving them to `specs/decisions/` would put a
  decision and its rationale in two places, which is the rule that made this
  Story necessary rather than a preference to trade away.
* No admitted finding is added to make the upgrade pass.
