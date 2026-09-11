# Story: DBCLI-040 A Claim That Has To Run

## Goal

Declaring a SQLite capability in `ENGINE_CAPABILITIES` without a CLI scenario
that actually exercises it fails verification, naming the matrix entry that has
no evidence.

## Context

PR #194 recorded the defect this Story closes the door on. DBCLI-034 and
DBCLI-035 implemented the SQLite adapter and executor and the matrix claimed
`list`, `query`, `insert`, `update`, `delete` and `export`; seven command
entrypoints each carried a private `['postgresql', 'mysql', 'mariadb']` literal
and refused the connection. Both Stories' tests were adapter- and
executor-level, so both passed. DBCLI-036 replaced the seven literals with one
guard, `src/commands/require-sql-connection.ts`, and added a regression block
to `tests/integration/sqlite-init.test.ts` that spawns the real CLI.

What DBCLI-036 did not do is tie that block to the matrix. The block is a list
of commands somebody remembered; the matrix is a list of commands the product
claims. Nothing compares them. A new `supported` row for SQLite — or a row that
flips from `unsupported` — passes `make verify` today with no spawn behind it,
which is the exact shape of the original defect with one fewer excuse.

Measured before writing: the SQLite column of `ENGINE_CAPABILITIES` carries
twenty-one entries whose status is `supported` or `limited`, the same predicate
ADR-0022's catalog uses for `engines`. Four of them — `auditTail`,
`auditShow`, `auditClear`, `auditHealth` — are claimed for every engine, but
they are claimed, so they are in scope: an audit entry written by a SQLite
query is an observable result like any other. `schema` and `schemaSingle`
are claimed while `schemaFullScan` is not; one scenario proves both by reading
a single table's columns. `queryOutput` and `queryLimitGuard` are parameters
of `query` rather than commands; each gets a scenario asserting the behaviour
the row describes, not the command exiting zero.

The scenarios spawn `bun run src/cli.ts`, the repository's own development
entrypoint, so every claim passes through Commander's parsing and the command
registration. Calling a handler, an adapter or an executor directly is what
let the original defect through and is not evidence here.

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: execution

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

* Level: low
* Reason: `test-only-change`

No product path changes. The risk is a reconciliation that can be satisfied
without running anything, which AC-004 and AC-006 exist to refuse.

## Scope

### In Scope

* `tests/integration/sqlite-cli/harness.ts` — one spawn helper, one seeded
  temporary database, one private `HOME`, shared with
  `tests/integration/sqlite-init.test.ts` so the fixture exists once.
* `tests/integration/sqlite-cli/scenarios.ts` — named CLI scenarios, each
  declaring which matrix keys it proves and asserting an observable result:
  rows or columns for reads, the file's contents for writes, the rendered
  output for exports, the configuration for connection management.
* `tests/integration/sqlite-cli/reconcile.ts` — a pure function over the
  matrix, the scenario registry and the set of scenarios that executed and
  passed. It reports declared keys no executed scenario proves, scenario claims
  no declared key backs, and registered scenarios that did not execute.
* `tests/integration/sqlite-cli-scenarios.test.ts` — runs every scenario, then
  reconciles against the real `ENGINE_CAPABILITIES.sqlite`.
* `tests/unit/sqlite-cli-reconcile.test.ts` — controlled fixtures for the
  three failure shapes.
* `tests/integration/sqlite-cli-gate-mutation.test.ts` — a preload that
  replaces the shared guard with the pre-DBCLI-036 literal, applied only to the
  spawned process, under which every scenario passing through the guard must
  fail while the adapter opened in the test process still reads rows.
* The regression block DBCLI-036 added to `sqlite-init.test.ts` moves into the
  scenario registry; the acceptance-numbered tests stay where DBCLI-036's
  evidence map points.

### Out of Scope

* Any change to `ENGINE_CAPABILITIES`. A row that is `unsupported` today stays
  `unsupported`, including `schemaFullScan`, which the command happens to
  execute for SQLite but the matrix does not claim.
* DBCLI-037, DBCLI-038, DBCLI-039.
* A global `story-check --ready` gate.
* A second roster of supported SQLite commands. The matrix is the source; the
  scenarios name keys of it.
* New dependencies, new test runners, new services.

## Inputs

* `src/adapters/capabilities.ts`, `src/commands/require-sql-connection.ts`,
  `tests/integration/sqlite-init.test.ts`, ADR-0022, PR #194.

## Outputs

* A `make verify` that fails when the SQLite column of the matrix gains a
  claim nobody spawned a CLI to prove.

## Rules

* R1: The declared set is derived from `ENGINE_CAPABILITIES.sqlite` at test
  time: every key whose status is `supported` or `limited`.
* R2: A scenario proves a key only if it executed and its assertions passed.
  A registered scenario that does not run contributes nothing.
* R3: A scenario may prove several keys; each key it names must be declared.
* R4: Every scenario spawns the CLI through `src/cli.ts` and asserts a result a
  user could observe, never only an exit code.
* R5: Fixtures live in a temporary directory with a private `HOME`, and are
  removed after the run.
* R6: No test-only switch enters `src/`.

## Expected Errors

* A declared key with no executed scenario — the reconciliation fails naming
  the key.
* A scenario naming a key that is not declared — the reconciliation fails
  naming the scenario and the key.
* A scenario that was registered but skipped — reported as unexecuted, and its
  keys count as unproven.

## Dependencies

* DBCLI-036 — the shared guard this Story's mutation targets, and the harness
  shape it generalises.
* ADR-0022 — the `supported | limited` predicate.

## Constraints

* Existing `bun test` only; `make verify` already runs every file under
  `tests/`, so the new files are executed without a new step.
* The mutation is applied through `bun run --preload` to the spawned process
  only. The product has no knowledge of it.

## Trust Boundary Fields

* `scenario.proves` — the matrix keys a scenario claims, validated against the
  matrix before they count
