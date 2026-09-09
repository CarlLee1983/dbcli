# Story: DBCLI-028 Delivery Is Not Authorization

## Goal

The handoff gate judges whether a delivery claim is backed by the repository, and
nothing else. Whether the implementing agent was permitted to commit or push is a
separate question that the fact of delivery cannot answer, so the gate stops
answering it.

## Context

DBCLI-027 added `reconcileDeliveryAuthority`: a Story in `completed_stories`
declaring `commit: no` or `push: no` fails `bun run forgeflow:check`, on the
reasoning that reaching `main` requires commits on a pushed branch. ADR-0030
recorded it.

The inference is wrong about *who*. `completed_stories` records that the Story
was delivered; it does not record who performed each operation. The normal
division of labour in this repository is exactly the counterexample: an agent is
granted `modify` and at most a local `commit`, and a human takes the branch from
there — commits it, pushes it, opens the pull request, merges it. Delivery is
complete and the agent's `push: no` was true the whole time. The gate refuses
that flow by name.

ADR-0030 wrote its own falsification condition for this: *falsified if delivery
stops implying a pushed branch*. What it missed is that delivery never implied
the **agent** pushed. It is falsified now, and by the case its author had in front
of them.

The second symptom is a split verdict on the same claim. Upstream ForgeFlow
0.7.0's Execution Contract (`protocol/execution.md`, revision
`cb4bc97673ad3098a4689a1589e1f2c4b5175c63`) defaults every operation other than
`plan` and `modify` to `no`, and says so in one sentence: *being able to commit,
push, deploy, add a dependency, or run a migration is never authorization to do
it*. So an omitted `push:` is a `no`. `reconcileDeliveryAuthority` fails the
explicit `no` and passes the omission — two spellings of one declaration, two
different verdicts, and the lenient one available to anyone who deletes a line.

What survives from DBCLI-027 is its useful half, which was never about Authority:
a declaration nothing compares to anything is not a control. That is why the
delivery reconciliation, the trailer evidence, the historical exemption ratchet,
the shallow-clone refusal and the lifecycle structure checks all stay exactly as
they are. Authority's format, defaults and combination legality stay upstream's
job, checked by `bun run forgeflow:contract` against the adopted revision.

The eight declarations DBCLI-027 rewrote from `no` to `yes` are **not reverted**.
Reverting them would be the same error mirrored: inferring from the absence of
evidence that permission was withheld. What is recorded instead is that those
eight values rest on a withdrawn inference and that no approval record confirms
them. ADR-0031 names them.

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
* push: no
* deploy: no

This Story is itself the case it is about: the implementing agent was authorized
to change these files and commit them locally, and a human takes it from there.
Its `push: no` is a statement, not a leftover.

## Architecture

* Impact: medium
* Decision: `ADR-0031`
* Boundary: `HandoffContract`
* Contract: `the handoff gate reconciles delivery claims and derives no permission from them`
* Owner: `HandoffContract = repository-governance`

## Risk

* Level: medium
* Reason: `governance-control-removal`

A gate is being removed, not added. The risk is that the reasoning removes more
than the defective rule, so every other rule in the gate keeps a test that fails
if it goes.

## Scope

### In Scope

* Removing `reconcileDeliveryAuthority`, `DELIVERY_IMPLIES` and `readAuthority`
  from `scripts/lib/forgeflow-handoff.ts`, and their use in
  `scripts/check-forgeflow-handoff.ts`.
* Replacing the tests of the removed rule with tests that hold delivery and
  authorization apart.
* ADR-0031, superseding ADR-0030 and keeping its measurement.
* The README paragraph and the `specs/handoff.md` section that state the removed
  implication.
* DBCLI-027's `Decision:` reference. Upstream rejects a `superseded` record as a
  dependency (`protocol/architecture.md`), so the reference is repointed at
  ADR-0031, which carries ADR-0030's measurement and links back to it. A pointer
  repair, not a change to what that Story claimed.

### Out of Scope

* Reverting the eight corrected declarations, or editing any historical
  Authority declaration without an approval record to correct it against.
* Any local re-implementation of Authority parsing, defaults or legality; any
  identity or approval store. Upstream owns the declaration, and human review
  owns whether it is true.
* Any change to `src/`, and any release or tag.

## Inputs

* `scripts/lib/forgeflow-handoff.ts`, `scripts/check-forgeflow-handoff.ts`,
  `tests/unit/scripts/forgeflow-handoff.test.ts`.
* ADR-0030, `README.md`, `specs/handoff.md`.
* Upstream `protocol/execution.md` at the revision `specs/.forgeflow-adoption`
  pins.

## Outputs

* A handoff gate that answers one question and does not derive permissions.
* A decision record naming the withdrawn inference and what is left unconfirmed.

## Rules

* R1: A Story in `completed_stories` is judged on whether the repository backs
  the delivery claim. Its `## Authority` cannot change that verdict.
* R2: A delivered Story declaring `commit: no` or `push: no` passes the gate. A
  human performing the operation is a permitted flow, not a discrepancy.
* R3: Omitting `## Authority`, or a permission within it, grants nothing. This
  gate reads no permission from any Story, so both spellings reach the same
  place: upstream's default, which is `no`.
* R4: Delivery reconciliation is unchanged — Story directory existence, `Story:`
  trailers, the `DELIVERED_BEFORE_TRAILERS` ratchet, the shallow-clone refusal
  and the lifecycle structure checks all still fail when they failed before.
* R5: No change to `src/`.

## Expected Errors

* A Story recorded as completed with no trailer and no exemption still fails,
  whatever its Authority declares.
* A `DELIVERED_BEFORE_TRAILERS` entry naming a commit this repository does not
  contain still fails.

## Dependencies

* ADR-0030 — the decision being superseded.
* ForgeFlow 0.7.0 `protocol/execution.md` — Authority's defaults and the rule
  that no operation implies another.

## Constraints

* `scripts/lib/forgeflow-handoff.ts` imports nothing and spawns nothing; the
  removal must not change that.
* The eight declarations DBCLI-027 rewrote stay as they are, with what is
  unconfirmed about them written down rather than guessed at in either direction.

## Superseded Behavior

* `tests/unit/scripts/forgeflow-handoff.test.ts` — the `reconcileDeliveryAuthority`
  suite asserts that a delivered Story declaring `commit: no` or `push: no`
  produces failures. That is the defect. The suite is replaced by one asserting
  the opposite, and the two cases it got right — an optional section declares
  nothing, an undelivered Story is not checked — survive as properties of a gate
  that reads no Authority at all.
* `docs/adr/ADR-0030-a-permission-nobody-filled-in-is-not-a-control.md` — its
  decision that delivery implies `commit` and `push` is superseded by ADR-0031.
  Its measurement stays current.
