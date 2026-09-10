# Story: DBCLI-030 An Attestation That Names The Step

## Goal

A FAIL attestation says which step failed, so a recorded failure can be told
apart from a different recorded failure without opening a log.

## Context

`.verification/attestation.json` records `result`, `exit_code` and the revision.
It does not record what went wrong, so every FAIL looks like every other FAIL.

That became concrete while reconciling DBCLI-029. ForgePilot recorded
`EV-048 FAIL at d387498b`; the cause was six test containers that had exited
hours earlier, and `services:check` — the third of twenty-three steps — refused
before a single test ran. The commit was fine, and `EV-049 PASS` at the same
revision proved it once the containers were up. Both records are true and the
evidence store keeps both, which is correct. What it cannot do is say that one
of them is about the machine and the other is about the code.

An evidence record that compresses "this commit is broken" and "this machine was
not ready" into the same word trains its readers to skip it, and a record nobody
reads is the failure mode this repository has now paid for three times in a
different costume.

The step name is available: the recipe knows which step it is running. It is
lost because the steps run inside a subshell, so the variable holding it dies
before the attestation is written. The subshell is not what makes the chain
stop — `&&` does, and `make` stops at a failing *line*, which is why the steps
were joined into one. Removing the grouping keeps both properties and lets the
name out.

DBCLI-017 refused to pass state between the two phases through a file: a
`run.json` left by a killed run would be adopted by the next `finish` and
produce one document describing two runs. That reasoning is untouched here and
is the reason this Story does not add a step file.

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
* Decision: `ADR-0033`
* Boundary: `VerificationAttestation`
* Contract: `a FAIL attestation names the step that failed, and no state crosses phases through a file`
* Owner: `VerificationAttestation = repository-governance`

## Risk

* Level: medium
* Reason: `verification-harness`

The change is to the recipe that decides every verdict this repository issues.
A mistake here does not produce a wrong record; it produces no verification.

## Scope

### In Scope

* `Makefile`: each step preceded by `step=<name>` on the same `&&` chain, the
  subshell grouping removed so the variable survives, and the name handed to
  `write-attestation.ts finish`.
* `scripts/write-attestation.ts` and `scripts/lib/verification-attestation.ts`:
  a `failed_step` field, written on FAIL and absent on PASS.
* `tests/contract/forgepilot-boundary.test.ts`: the roster stays literal and
  gains the marker for each step, and the prologue and epilogue comparisons
  follow the recipe.
* ADR-0033.

### Out of Scope

* Per-step timing. The Makefile records it as DBCLI-019's inherited cost; naming
  the failing step does not need it, and adding it here would put two changes in
  one recipe.
* Starting the test services from `make verify`. That would make Docker a
  dependency of the canonical gate, which DBCLI-014 deliberately avoided, and
  the services are shared by port so two runs would collide. `services:check`
  already refuses rather than passing, which is the behaviour worth keeping.
* Any change to `src/`, and any release.

## Inputs

* `Makefile`, `scripts/write-attestation.ts`,
  `scripts/lib/verification-attestation.ts`,
  `tests/contract/forgepilot-boundary.test.ts`,
  `tests/unit/scripts/verification-attestation.test.ts`.

## Outputs

* A FAIL attestation naming its step.
* A contract test that fails if a step is added without a marker.

## Rules

* R1: A FAIL attestation carries `failed_step` naming the step that failed.
* R2: A PASS attestation carries no `failed_step`. Nothing failed, and a field
  naming the last step would read as one.
* R3: No state crosses `begin` and `finish` through a file. The name travels
  through the recipe's own shell, as the revision already does.
* R4: Every step is preceded by its marker, and the contract test fails on a
  step that has none — an unmarked step would be attributed to the step above it,
  which is worse than no field at all.
* R5: The step roster is unchanged in content and order, and every step is still
  blocking.
* R6: The recipe stays POSIX and free of `pipefail`.
* R7: The attestation still never decides the verdict: a failure to write one
  costs a record, never a result.
* R8: No change to `src/`.

## Expected Errors

* `finish` given the wrong number of arguments names what it expected, as it
  already does.
* A step added to the Makefile without a marker fails the contract test.

## Dependencies

* ADR-0033 — the decision and its falsification condition.
* DBCLI-017 — the two-phase attestation and why no file crosses the phases.

## Constraints

* The recipe must keep recording a FAIL. A change that only records passing runs
  removes the evidence this Story is trying to improve.

## Superseded Behavior

* `tests/contract/forgepilot-boundary.test.ts` — `PROLOGUE`, `EPILOGUE` and the
  recipe parser pin the subshell grouping and the bare step strings. The
  grouping is what discards the step name, so those literals change deliberately
  and the roster gains a marker per step.
* `tests/unit/scripts/verification-attestation.test.ts` — the serialised-shape
  assertions gain the `failed_step` field on the FAIL path.
