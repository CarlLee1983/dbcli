# Story: DBCLI-038 A Frozen Hash Of A Derived Thing

## Goal

Decide what the capability-catalog surface guard is protecting, and give it a
shape that ordinary engine work does not break.

## Context

`tests/fixtures/plat004/legacy-surface-baseline.json` pins a sha256 of three
renderings of the capability catalog — JSON, text and Markdown — and
`tests/integration/lazy-entry-path.test.ts` compares a real process's stdout
against them. It was captured at `cc7427be` to prove PLAT-004's lazy entry path
did not change the surface it inherited.

ADR-0022 makes that catalog *derived*: `ENGINE_CAPABILITIES` is the authority,
and the catalog reads engines and risk out of it. So every change to the matrix
changes all three hashes, by construction.

Three deliveries have now moved them for exactly that reason:

| Delivery | Why the surface moved |
| --- | --- |
| `b80a236a` | bounded evidence receipts added capabilities |
| DBCLI-034 | a seventh engine appeared in 26 of 53 capabilities |
| DBCLI-035 | SQLite claimed `insert`, `update` and `delete` |

Each time, the fix was the same: regenerate the three values, leave
`baselineCommit` alone. A guard whose expected repair is "write down whatever it
says now" catches nothing on the third repetition that it did not catch on the
first — it reports that the catalog changed, which the diff already says, and it
cannot report *how*.

The rest of that fixture does not have this problem. `standalone version`,
`unknown root option`, the two human-error renderings and `command-local
for-agent` pin surfaces nothing derives, and none of them has moved.

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: architecture

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: medium
* Boundary: `LegacySurfaceBaseline`
* Contract: `a guard over derived output states what must not change, not what the output happened to be`
* Owner: `LegacySurfaceBaseline = repository-governance`

## Risk

* Level: medium
* Reason: `guard-removal`

Weakening a guard is easy to do by accident while making it survivable.

## Scope

### In Scope

* Deciding, and recording as an ADR, what the three capability-catalog cases
  are for now that ADR-0022 derives the catalog. The plausible answers are:
  keep the sha256 and accept the regeneration as the cost; replace it with
  structural assertions (the document parses, its schema version is what the
  contract says, every capability names a live command, the three renderings
  agree with each other); or drop the three cases because the contract test in
  `tests/contract/` already asserts the derivation.
* Implementing whichever is decided, including removing what it replaces.
* Leaving the other five cases in the fixture exactly as they are.

### Out of Scope

* `ENGINE_CAPABILITIES` itself, and any engine's rows in it.
* `tests/fixtures/plat004/capabilities-check-baseline.json`, which pins a
  different surface and has not shown this behaviour.
* The `baselineCommit` pin and its assertion, whatever is decided about the
  hashes: it names the capture this fixture descends from, and that stays true.

## Inputs

* `tests/fixtures/plat004/legacy-surface-baseline.json`,
  `tests/integration/lazy-entry-path.test.ts`,
  `tests/contract/` capability tests, ADR-0022.
* `git log` for the three deliveries above.

## Outputs

* An ADR saying what this guard protects.
* A guard that matches it.

## Rules

* R1: Whatever replaces the hashes fails when the catalog's *contract* breaks —
  a missing schema version, a capability naming no live command, two renderings
  disagreeing — and does not fail when an engine gains a supported command.
* R2: If the answer is to keep the hashes, the ADR says why the regeneration
  cost is worth paying, and nothing in the fixture changes.
* R3: The other five cases keep their current assertions.
* R4: No change to `src/`.

## Expected Errors

* A catalog that breaks its contract fails the guard, naming what broke.

## Dependencies

* ADR-0022 — the derivation that creates the tension.
* DBCLI-034, DBCLI-035 — the two deliveries that made it visible.

## Constraints

* A guard that is deleted without a replacement needs the ADR to say what is no
  longer watched, and by whom instead.
