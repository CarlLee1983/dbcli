# Story: DBCLI-032 One Build Fewer

## Goal

`make verify` builds the artifacts twice instead of three times, and a build
that fails inside the determinism check says why.

## Context

DBCLI-031 made the gate's per-step timings visible for the first time. The
measurement it produced, on an eleven-minute run:

```text
<== [11] bun run build 59s exit 0
<== [12] bun run build:determinism 116s exit 0
```

`build:determinism` builds twice and compares the digests — that is the check,
and its 116 seconds are the price of the property. The 59 seconds above it are
not. Step 11 builds the same artifacts from the same source, and step 12
overwrites them with two more builds before anything reads them: the steps
between are `bun run dev`, which runs from source. The steps that do read
`dist/` come after, and they read what step 12 left — which the check itself has
just proved is byte-identical to what step 11 produced.

So the roster contains one build whose only output is the wall-clock it spent.
Removing it is the kind of change the roster's own comment says must be argued
for rather than assumed, which is why this Story exists instead of a commit.

One thing the redundant step was quietly providing: a build failure with its
output on screen. `check-build-determinism.ts` runs `bun run build` with
`.quiet()`, so a broken build inside it throws with its diagnostics discarded.
Removing step 11 without fixing that trades a minute of gate time for an
unreadable failure, which is not a trade worth making.

## Classification

* Security sensitive: no
* Baseline conformance: yes
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
* Decision: `ADR-0035`
* Boundary: `VerificationAttestation`
* Contract: `every step in the roster produces something a later step or a human reads`
* Owner: `VerificationAttestation = repository-governance`

## Risk

* Level: medium
* Reason: `verification-harness`

A step is being removed from the repository's verification contract. The roster
exists so that this cannot happen by accident, and the argument has to survive
review rather than the diff being small.

## Scope

### In Scope

* `Makefile`: `bun run build` removed from the `verify` roster.
* `tests/contract/forgepilot-boundary.test.ts`: `REQUIRED_STEPS` loses that
  entry and gains an assertion that the roster still builds — the artifacts the
  later steps execute must be produced by a step, and `build:determinism` is now
  the only step that produces them.
* `scripts/check-build-determinism.ts`: a failing build reports its own output
  and which of the two builds failed, instead of throwing with the diagnostics
  discarded.
* ADR-0035.

### Out of Scope

* Making `build:determinism` faster. Its two builds are the property being
  checked; building once and trusting it is not a cheaper check, it is no check.
* Building the two artifacts sets concurrently. They write the same output
  directory, and separating them to make them parallel is a design change to buy
  seconds this Story is not spending.
* Any other step in the roster.
* Any change to `src/`, and any release.

## Inputs

* `Makefile`, `tests/contract/forgepilot-boundary.test.ts`,
  `scripts/check-build-determinism.ts`.
* The per-step timings from DBCLI-031's first run.

## Outputs

* A gate that builds twice per run instead of three times, with the same checks.
* A determinism check whose build failures are readable.

## Rules

* R1: The roster no longer contains `bun run build`, and every step that reads
  `dist/` still runs after a step that produced it.
* R2: A build that fails inside `build:determinism` reports which build failed
  and prints the build's own output.
* R3: The determinism property is unchanged: two builds of identical source,
  four artifacts, digests compared, a difference fails.
* R4: The roster is otherwise unchanged in content and order, and every step
  still blocks.
* R5: No change to `src/`.

## Expected Errors

* A failing build inside the determinism check exits non-zero with its output
  shown and the failing build named.
* A step reading `dist/` placed before the step that builds fails the contract
  test.

## Dependencies

* ADR-0035 — the decision and its falsification condition.
* ADR-0034 — the per-step timings this Story is acting on.

## Constraints

* `bun run build:determinism` must stay runnable on its own, from a checkout
  with no `dist/`.

## Superseded Behavior

* `tests/contract/forgepilot-boundary.test.ts` — `REQUIRED_STEPS` pins
  `bun run build` as a required step. That is the entry being argued away, and
  the roster's comment requires the argument to be recorded rather than the list
  edited quietly.
