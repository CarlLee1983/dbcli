# Story: DBCLI-018 ForgeFlow Adoption Upgrade

## Goal

A Story written in this repository can declare what the agent may do, how risky
the change is, and what evidence proves each acceptance criterion — and those
declarations are checked by something, rather than being sections nobody reads.

## Context

The adoption marker recorded ForgeFlow 0.3.2 from revision `7bbdf443`. Upstream
is 0.6.0. Measured on 2026-09-08, from checkouts of both tags:

* **The upgrade breaks nothing.** Running upstream `story-check` over all 25
  Story directories gives the identical result under v0.3.2 and v0.6.0: 21
  findings across 5 Stories, the same 21. No existing Story fails for a reason
  0.6.0 introduced.
* **It fixes something.** `handoff-check` goes from `HANDOFF_CONTRACT_INCOMPLETE`
  to `HANDOFF_CONTRACT_OK`. The eight `completed Story is not a Story ID:
  DBCLI-PLAT-*` failures were 0.3.2's Story ID grammar predating that naming;
  0.6.0 widened it. `docs/releases/0.6.0.md` names this repository as the survey
  that prompted the change.
* **The upgrade is four files.** `./scripts/bootstrap --upgrade` replaces the
  three `specs/stories/_template/` files and the marker, and nothing else;
  `AGENTS.md` and guidance became repository-owned at install. A dry run against
  this repository listed exactly those four, and the three templates were
  byte-identical to the v0.3.2 originals, so no local wording was overwritten.
* **The 21 findings predate everything.** They are three kinds of wording — a
  trust-boundary field written as prose, a security fixture cell written as
  prose instead of an exact backticked value, and one Story whose Classification
  contradicts its own Superseded Behavior. Nothing ever reported them, because
  `make verify` runs this repository's own TypeScript reconciliation and has
  never run upstream's checkers.

That last point is the one that decides this Story's shape. Authority, Risk,
Task mode and the Acceptance Evidence map are all optional at 0.6.0 and all
enforced by upstream checkers only. Moving the marker without running those
checkers would change what a Story is permitted to say and nothing about what is
checked — which is the shape of adoption that DBCLI-013 and DBCLI-016 both had
to close afterwards.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: no

## Scope

### In Scope

* Upgrading the adoption through upstream's own mechanism, `./scripts/bootstrap
  --upgrade`, rather than by editing the marker.
* Pinning the marker to the `v0.6.0` tag rather than to whichever checkout
  bootstrap happened to run from.
* Bringing every adoption surface to the new version, which
  `bun run forgeflow:check` already enforces.
* A CI job that fetches the adopted revision and runs upstream `story-check` and
  `handoff-check` against this repository, reconciled against a shrinking list
  of the findings that predate it.
* An ADR recording why upstream's checkers are run rather than reimplemented.

### Out of Scope

* Fixing the 21 pre-existing findings. They are admitted exactly, per Story, and
  belong to their own Story: sixteen of them are matrix cells whose real values
  have to be re-derived from the code they describe, and all of them are edits
  to acceptance text a human already accepted.
* Adding `Authority`, `Risk`, `Task mode`, `Architecture` or an Acceptance
  Evidence map to any existing Story. The upgrade makes them expressible; it
  does not retrofit them.
* `scripts/story-check --ready`, which requires an Acceptance Evidence map for
  every Story and currently reports 71 findings. Adopting it is a decision about
  every future Story, not a side effect of an upgrade.
* Installing upstream's `templates/story/verification.md`. Bootstrap does not
  manage it, and the verification result contract has no consumer here yet.
* Any change to `make verify`, its steps, or its offline guarantee.
* Any change to `src/`, or to what dbcli ships.

## Inputs

* `specs/.forgeflow-adoption`, as the record of which contract applies.
* A ForgeFlow checkout at that revision, provided by CI through
  `FORGEFLOW_ROOT`.
* Every `specs/stories/*/story.md` and `acceptance.md`, and `specs/handoff.md`.

## Outputs

* An adoption marker naming 0.6.0 and the `v0.6.0` tag.
* Templates carrying the new optional sections, for Stories written next.
* `bun run forgeflow:contract`, and a CI job that runs it.
* An exact, per-Story record of the 21 findings this repository has not yet
  fixed.

## Rules

* R1: The upgrade is performed by upstream's `bootstrap --upgrade`, and the only
  files it changes are the three templates and the marker.
* R2: The recorded revision is the one the recorded version names. A marker
  saying `0.6.0` while pointing at a commit after the tag gives "which release
  is this" two answers.
* R3: The contract gate refuses a ForgeFlow checkout whose revision is not the
  adopted one, and refuses to run with no checkout at all rather than skipping.
* R4: Every finding upstream reports is either absent or listed exactly. A new
  finding fails; a listed finding that has been fixed fails as a stale entry; a
  Story with no entry must be clean.
* R5: The list may shrink and never grow.
* R6: `make verify` gains no step, keeps its existing steps in order, and still
  runs offline from a clone of this repository alone.

## Expected Errors

* A contract check with no `FORGEFLOW_ROOT` refuses, naming the commands that
  produce a usable checkout.
* A checkout at another revision refuses, naming both revisions.
* A Story that acquires a new finding fails with the finding quoted, not with a
  count.

## Dependencies

* Network access in the CI job that clones ForgeFlow. `make verify` gains none.

## Constraints

* The two existing ForgeFlow gates stay offline and stay inside `make verify`.
* Upstream's rules are run, not reimplemented: two implementations of one
  contract diverge on a schedule nobody controls.
