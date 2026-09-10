# Story: DBCLI-031 A Verify Log That Says Where It Is

## Goal

`make verify` says which step it is running and how long each one took, so a
run that is failing, hanging or merely slow can be read while it happens rather
than reconstructed afterwards.

## Context

The Makefile has carried this as a named, unpaid cost since DBCLI-017. Each step
used to be its own recipe line, so `make` echoed it and a log showed which check
was running and which one stopped. Joining the steps into one `@`-prefixed line
— which is what makes a FAIL recordable, because `make` stops at a failing
*line* — took that away.

DBCLI-030 paid half of it: a FAIL attestation now names the step it stopped at.
That is the half you read afterwards. The half you read *during* is still
missing, and it is the half that matters while a twelve-minute gate is running:
nothing says whether it is on step 3 or step 20, and nothing says that
`bun run test` took eleven of those minutes.

Both halves were recorded in the Makefile rather than quietly accepted, so this
Story is collecting a debt the repository wrote down itself.

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
* Decision: `ADR-0034`
* Boundary: `VerificationAttestation`
* Contract: `every step announces itself and its duration, and a step's label and its command are one string`
* Owner: `VerificationAttestation = repository-governance`

## Risk

* Level: medium
* Reason: `verification-harness`

The recipe decides every verdict this repository issues. The failure mode to
guard is not a wrong record but a gate that stops running, or one whose steps
stop blocking.

## Scope

### In Scope

* `Makefile`: a `run` shell function that prints the step, runs it, and prints
  its duration and exit status, with each step line becoming
  `step='<command>' && run`.
* `tests/contract/forgepilot-boundary.test.ts`: the roster stays literal, every
  step line is `step='<command>' && run`, and the prologue pins the function.
* ADR-0034.

### Out of Scope

* Any change to which steps run, their order, or their blocking behaviour.
* Sub-second timing. `date +%s` is POSIX and whole seconds answer the question
  being asked; a millisecond clock here would be precision this log cannot use.
* Machine-readable per-step output in the attestation. The document records one
  run's verdict and the step it stopped at; a per-step table is a different
  artifact and would move the schema again for something a log already says.
* Any change to `src/`, and any release.

## Inputs

* `Makefile`, `tests/contract/forgepilot-boundary.test.ts`.
* ADR-0033 — the attestation half of the same debt.

## Outputs

* A verify log that names each step, numbers it, and times it.
* A contract test that fails if a step stops announcing itself.

## Rules

* R1: Each step prints its number and name before it runs, and its number,
  name, duration and exit status after it.
* R2: A step's label and its command are one string. Two copies that can
  disagree would put a step's name on another step's output, and a log that
  misattributes is worse than one that says nothing.
* R3: Every step still blocks: the chain stops at the first failure and the
  recipe re-exits with that status.
* R4: The step roster is unchanged in content and order.
* R5: The recipe stays POSIX — `dash` runs it on the Ubuntu runner — and free
  of `pipefail`.
* R6: `failed_step` in the attestation is unchanged and still names the step the
  run stopped at.
* R7: No change to `src/`.

## Expected Errors

* A failing step prints its own line with a non-zero exit status before the
  chain stops.
* A step line that does not announce itself fails the contract test.

## Dependencies

* ADR-0034 — the decision and its falsification condition.
* ADR-0033 — the attestation names the failing step; this is the live half.

## Constraints

* Nothing may swallow a step's own output or alter its exit status.
* The two attestation phases still exchange state through the recipe's shell,
  never a file.

## Superseded Behavior

* `tests/contract/forgepilot-boundary.test.ts` — the recipe parser compares each
  step's marker against the command spelled beside it. There is no second copy
  to compare once the command is the marker, so that assertion is replaced by
  one that every step line invokes `run`.
