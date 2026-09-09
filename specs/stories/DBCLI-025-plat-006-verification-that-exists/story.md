# Story: DBCLI-025 A Verification Column That Names a Test That Exists

## Goal

Every row of DBCLI-PLAT-006's security fixture matrix names a test that actually
asserts it, and the three rows that had no test get one.

## Context

PLAT-006's six findings all say the same thing: `security fixture row N states
verification as prose instead of an exact value`. Rows 1, 2 and 6 read
`focused audit and envelope tests`; rows 3, 4 and 5 read
`root-option validation test`.

Replacing that prose with a path is a two-minute change and would have been
wrong for half the rows. Looking for the tests found that **three of the six
were asserting nothing**, and two more were asserting half of what they claim:

| Row | Payload | Claim | What existed |
| --- | --- | --- | --- |
| 1 | `DBCLI-PLAT-006` | preserve, both sinks | audit only |
| 2 | `INC-2026.09.05` | preserve, both sinks | envelope only |
| 3 | `../../PLAT006_PATH` | reject | covered |
| 4 | `postgresql://plat006:…` | reject | nothing |
| 5 | `SELECT * FROM users…` | reject | nothing |
| 6 | `PLAT006_RAW_ERROR_SENTINEL` | preserve, both sinks | nothing at all |

Rows 4 and 5 look covered and are not. Their payloads do appear in
`tests/unit/core/operation-envelope.test.ts` — but in the test for
`OperationEnvelope.context.correlationId`, which is a **different source field**
and has its own row in this same matrix. Citing that file for an
`argv --correlation-id` row would have been a citation that resolves, reads
plausibly, and proves nothing about the row it is attached to. Row 6's payload
appears nowhere under `tests/` at all.

The behavior was never in doubt: `CORRELATION_ID_PATTERN` is
`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/`, the three rejected payloads each contain
a character outside it, and the three preserved payloads each match. What was
missing was anything asserting it. The tests added here pass on first run
against unmodified `src/`, which is the evidence that this Story found a
coverage gap rather than a defect.

This is the argument for having listed the twenty-one findings exactly rather
than tolerating a count. "Six cells are worded loosely" and "three security
fixture rows assert nothing" are the same line in the checker's output.

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

* Impact: low

## Risk

* Level: medium
* Reason: `absent-coverage`

The tempting fix writes a plausible test path into each cell and leaves three
rows asserting nothing, with the gate green and the matrix reading as though it
were covered — strictly worse than the prose, which at least did not name a file.

## Scope

### In Scope

* Extending the `--correlation-id` rejection cases in
  `tests/integration/lazy-entry-path.test.ts` with rows 4 and 5's payloads.
* Making the envelope test in `tests/integration/capabilities-command.test.ts`
  and the audit test in `tests/unit/core/audit/integration-helper.test.ts` run
  over all three preserved payloads, so rows 1, 2 and 6 are each asserted at
  both sinks they claim.
* Replacing all six Verification cells with the test files that now assert them.
* Deleting PLAT-006's entry from `PREDATING_FINDINGS`.

### Out of Scope

* Any change to `src/`. The behavior is already correct; only the assertions
  were missing.
* Rows 7 and 8, which already name an exact file and are unchanged.
* The matrix's payloads, expected results and persisted locations. This Story
  makes the verification column true, not the rows different.

## Inputs

* `src/core/correlation-id.ts` — `CORRELATION_ID_PATTERN`.
* The three test files named above.

## Outputs

* A PLAT-006 Story upstream `story-check` reports no finding against.
* Six fixture rows whose cited tests assert them.

## Rules

* R1: A Verification cell names a test that asserts that row's payload at that
  row's source field. A test of a different source field is not a citation.
* R2: A row claiming two sinks is asserted at both.
* R3: The added tests pass against unmodified `src/`. A failure would mean this
  Story found a defect, which is a different Story.
* R4: No exemption other than PLAT-006's is added, removed, renamed or
  broadened.

## Expected Errors

* A cell citing a file that does not assert its row passes the checker and fails
  R1; only reading the test catches it.
* A stale count fails `tests/unit/scripts/forgeflow-contract.test.ts`.

## Dependencies

* `scripts/lib/forgeflow-contract.ts` — the exemption list and its counts.

## Constraints

* `bun run forgeflow:contract` is not in `make verify`; both must pass.
