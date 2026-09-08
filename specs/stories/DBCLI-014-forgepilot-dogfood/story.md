# Story: DBCLI-014 ForgePilot Work Control Plane Dogfood

## Goal

A maintainer or agent picking up dbcli can learn what work is actionable next,
and can produce verification evidence that is bound to an exact commit, without
changing how dbcli specifies or verifies engineering work.

## Context

dbcli already runs ForgeFlow: Stories under `specs/stories/` carry the
requirements and acceptance criteria, and root `make verify` is the canonical
verification command. Neither of those says which Story to work on next, nor
records that a given verification result belonged to a particular revision.
`specs/handoff.md` carries that by prose, and the prose has drifted before —
DBCLI-013 and DBCLI-PLAT-013 both closed out drift that nothing was reconciling.

ForgePilot is a local, network-free CLI that holds the work queue, human
decisions and verification evidence. It runs the managed project's own
`make verify` in a detached worktree at an exact commit, so evidence cannot be
claimed for code that was never checked out.

Running dbcli's verification from a fresh checkout is the part that has never
been exercised. CI runs `bun install --frozen-lockfile` before every job; the
`Makefile` does not, so `make verify` describes a verification contract that
only holds on a machine where dependencies happen to already be installed. That
is the reproducibility question this Story exists to answer.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: no

## Scope

### In Scope

* `make verify` bootstraps its own dependencies so that it runs from a clean
  checkout of the exact commit under verification.
* Repository guidance naming which tool owns which layer: ForgePilot for work
  selection and evidence, ForgeFlow for Story and acceptance criteria, dbcli's
  `make verify` for verification itself.
* `.forgepilot/` is ignored by Git.

### Out of Scope

* Any change to ForgeFlow's Story schema, the template, or the adoption marker.
* Any dbcli source, runtime, or packaging dependency on ForgePilot.
* Importing already-delivered Stories into the ForgePilot queue.
* Weakening, skipping, or reordering any existing step of `make verify`.
* Copying ForgePilot's documentation into this repository.

## Inputs

* The exact commit ForgePilot resolves from HEAD before verification.
* `bun.lock`, as the pinned dependency set for that commit.
* The integration services described by `docker-compose.test.yml`, reached over
  host ports.

## Outputs

* A `make verify` run that starts from a checkout carrying no `node_modules`.
* Verification evidence in ForgePilot's state, bound to that commit SHA.
* Guidance in `AGENTS.md` telling the next agent the order of operations.

## Rules

* R1: `make verify` installs the dependency set pinned by `bun.lock` before any
  step that consumes it, and fails rather than resolving a different set.
* R2: Every step of `make verify` present before this Story is still present
  after it, in the same order.
* R3: No file that dbcli builds, tests, publishes, or executes at runtime
  imports, spawns, or requires ForgePilot.
* R4: `.forgepilot/` is ignored by Git, so ForgePilot's operational state is
  never a source artifact of this repository.
* R5: ForgeFlow remains the only source of Story structure: this Story adds no
  field, section, or file to the Story contract.

## Expected Errors

* A checkout whose `bun.lock` does not satisfy `package.json` fails the install
  step and therefore `make verify`, rather than silently installing a resolved
  set that nothing pinned.
* Verification against a dirty worktree is refused by ForgePilot, because a
  commit cannot describe uncommitted content.

## Dependencies

* ForgePilot must be installed and initialized in the repository root.
* The integration services must be reachable; `bun run services:check` is the
  existing step that says so.

## Constraints

* ForgePilot is an operator tool, not a dependency: cloning dbcli and running
  `make verify` must keep working with no ForgePilot installed.
* The install step must not reach for a network-resolved dependency set beyond
  what the lockfile pins.
