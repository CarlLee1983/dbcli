# Story: DBCLI-017 Portable Verification Attestation

## Goal

A reviewer, a CI job, or a future session can answer "was this exact revision
verified, by what command, with what result" from a file that travels — without
a ForgePilot install, without `.forgepilot/state.json`, and without trusting
anybody's recollection.

## Context

Verification evidence exists today in exactly one place: `.forgepilot/state.json`
on the machine that ran it. That file is gitignored on purpose — committing it
would make `make verify` dirty the worktree ForgePilot refuses to verify, and
recording a result would take a commit that immediately invalidates the result
being recorded. So the evidence is real, and it is unreachable from anywhere
else. DBCLI-016's delivery report had to say "the Evidence IDs live in
ForgePilot's state, deliberately not restated here" for exactly this reason.

Two facts constrain the design more than the schema does.

**ForgePilot has no export.** Its commands are `init`, `migrate`, `goal`,
`work`, `next`, `start`, `verify`, `gate`, `review`, `status` — verified by
reading `internal/cli/cli.go` at `8ce2c12`. `docs/development-plan.md` contains
no export roadmap. Waiting for one would make this Story's delivery depend on
another repository's schedule, and reaching into `.forgepilot/state.json` would
couple dbcli to ForgePilot's internal format — the boundary DBCLI-014 drew.

**`make verify` is the fixed command.** ForgePilot runs the managed project's
`make verify` and records the exit code (`internal/work/evidence.go` and its
tests). It is also the only participant that observes the result first-hand. So
the attestation is written by the repository's own verification, and ForgePilot
— or CI, or a human — reads the file afterwards. dbcli stays the producer of a
standard artifact; nothing imports anything.

Two names in this repository are already taken, and both are close enough to
mislead:

* **Evidence receipt** (`CONTEXT.md`, `src/core/evidence-receipt/`) is a product
  artifact: a bounded record of one dbcli operation against a database, shipped
  to users, versioned by `EVIDENCE_RECEIPT_VERSION`.
* **Verification artifact** (`src/core/verification/`) is also a product
  artifact, about `assert`, `snapshot` and `recovery-verify` runs against data.

Neither is about a repository revision, neither is read by a reviewer of this
repository, and reusing either would move a shipped schema version for reasons
that have nothing to do with the product. This Story introduces a third term,
**Verification Attestation**, and records why in an ADR. `attestation` appears
nowhere in dbcli or ForgePilot today.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: yes
* Baseline conformance: yes

## Scope

### In Scope

* A Verification Attestation: one versioned, machine-readable JSON document
  describing one run of `make verify` against one revision.
* A writer under `scripts/`, invoked by `make verify`, that writes the
  attestation on both PASS and FAIL to a gitignored path.
* Canonical serialisation, so the same run serialises to the same bytes, and a
  content hash that is the attestation's identity.
* Uploading the attestation from the existing CI `integration` job as a GitHub
  Actions artifact — the smallest real proof that the document travels.
* `CONTEXT.md` gains the term; an ADR records the boundary and its falsification
  condition.

### Out of Scope

* Any change to ForgePilot, and any read of `.forgepilot/`.
* Per-step timings, step names, or a failed-step field — DBCLI-019 owns
  verification observability, and this Story's schema must leave room for it
  rather than pre-empt it.
* PR checks, PR comments, and any external evidence store.
* Signing, notarising, or any trust claim beyond "this file says what the run
  said".
* Reusing or extending `src/core/evidence-receipt` or `src/core/verification`.
* Any dbcli runtime, packaging, or source dependency on the attestation writer.
* Removing, reordering, weakening, or making non-blocking any existing step of
  `make verify`.

## Inputs

* The revision `git rev-parse HEAD` resolves to, and whether the worktree is
  clean, both read at the start of the run.
* The exit status of the verification steps.
* The wall-clock start and finish instants.
* A bounded description of the environment: OS, architecture, Bun version, and
  whether `CI` is set.

## Outputs

* `.verification/attestation.json`, gitignored, overwritten by each run.
* On CI, the same document as a build artifact retrievable from the run.

## Rules

* R1: The attestation names the full 40-character revision resolved before the
  first step ran, and states whether the worktree was clean. A run against a
  dirty worktree produces an attestation that says so, never one that implies
  the commit was what was tested.
* R2: The attestation is written on FAIL as well as on PASS, and `make verify`
  still exits non-zero on FAIL. Neither attestation phase can change the exit
  status in either direction: a failure to write never turns a FAIL into a PASS,
  and never turns a PASS — or a run that has not started yet — into a failure.
* R3: Every step of `make verify` present before this Story is still present
  after it, in the same order, and still blocking.
* R4: The document contains no secret, credential, environment dump, absolute
  path, hostname, or user name. Only the fields the schema names appear.
* R5: The same run serialises to identical bytes: keys in a fixed order, LF
  endings, one trailing newline, no locale- or platform-dependent formatting.
* R6: `schema_version` is an integer that moves when a field, its requiredness,
  or the meaning of a value changes, and never because the npm package version
  moved — the rule the other artifact versions already follow.
* R7: The attestation is repository tooling, not product: no file under `src/`
  imports the writer, and the published package does not contain it.
* R8: Staleness is computed by the reader, not stored. The document states a
  revision; whether that revision is still HEAD is a question the reader
  answers, so an attestation can never claim to be current.

## Expected Errors

* A run in a repository with no git history, or where `git rev-parse HEAD`
  fails, refuses to write an attestation rather than writing one with an unknown
  revision.
* An unwritable output path is reported, and the verification result stands
  unchanged — the attestation records the run, it does not decide it. This holds
  for the phase that runs before the first step as much as for the one that runs
  after the last.
* A reader given an attestation whose `schema_version` it does not know refuses
  it rather than reading the fields it recognises.

## Dependencies

* `git`, already required by `bun run forgeflow:check`.
* Nothing else. No network, no ForgePilot, no ForgeFlow checkout.

## Constraints

* The output path must be gitignored. An attestation inside the worktree that
  Git can see would dirty the tree ForgePilot requires to be clean, and would
  make each verification invalidate the last one's record.
* `make verify` must keep working with no ForgePilot installed and no CI.
* The schema must leave room for DBCLI-019's per-step detail to be added under a
  new `schema_version` without restating anything this Story defines.
* Every field must be something `make verify` observed. A value that is only
  ever handed to the producer records what the caller claimed, whether the
  handing happens at call time or at authoring time — which is why this Story
  carries no `work_item`, no `story`, and no `repository`.

## Trust Boundary Fields

Required when `Security sensitive: yes`.

Every value that reaches the attestation from outside the writer's own control:

* `environment.os`, `environment.arch` — from `process.platform` / `process.arch`
* `environment.bun` — from `Bun.version`
* `environment.ci` — from the presence of the `CI` environment variable, as a
  boolean; the variable's value is never copied
* `revision`, `dirty_worktree` — from `git rev-parse HEAD` and `git status
  --porcelain`
* `exit_code` — from the verification run
* `started_at`, `finished_at` — from the system clock

No other environment variable, no command output, and no filesystem path enters
the document.

## Superseded Behavior

Required when `Baseline conformance: yes`.

* `tests/contract/forgepilot-boundary.test.ts` — its `REQUIRED_STEPS` roster
  pins the exact step list of `make verify`. This Story changes how the recipe
  invokes those steps so that a result is recorded on both outcomes, which the
  roster's own comment says must be argued for rather than done quietly. The
  argument is R2 and R3: every step stays, in order, still blocking; what
  changes is that the recipe no longer stops without recording that it stopped.
* `Makefile` — the `verify` recipe as a bare list of steps.

## Known Cost

Joining the steps into one subshell loses make's per-step echo, so a CI log no
longer names the check that was running when the gate failed. Diagnosis leans on
the failing tool's own output instead. Restoring it properly means echoing each
step with its own timing, which is DBCLI-019's subject; it is recorded here and
in the `Makefile` so that Story inherits a known cost rather than rediscovering
it.

## Recorded Decisions

**How `make verify` records a FAIL.** `make` stops at the first failing step, so
an attestation written as a final step is written only on PASS — the case that
matters least. Decided on 2026-09-08: wrap the existing steps in a subshell,
capture the status, write the attestation, re-exit with that status. Every step
stays visible in the `Makefile` and the boundary test's roster still reads them
from there, which keeps the canonical gate's definition where this repository
has always kept it. The cost accepted is a recipe that now contains shell a
reader has to trust to propagate the exit code, which R2 and its failing-run
criterion exist to hold to account.

The alternative — moving the step list into a `scripts/` runner — was considered
and deferred, not rejected: it is close to free for DBCLI-019's per-step timings
and failed-step field, and reassessing it belongs to that Story rather than to a
guess made here.

**What the attestation does not carry.** Decided on 2026-09-08: no `work_item`
and no `story` field. `make verify` does not know either value, so both would
have to arrive from the caller, and a producer that cannot verify a field
records whatever it was handed. ForgePilot already binds evidence to work by
revision and can bind this the same way. This is a deferred decision with an
explicit reopening condition, recorded in ADR-0026.
