# Story: DBCLI-026 The Receipt Fixtures Name the Fields They Came From

## Goal

DBCLI-PLAT-007's eight fixture rows name the exact field each payload enters
through, and its trust-boundary section names fields instead of categories —
emptying the exemption list.

## Context

PLAT-007's nine findings are eight matrix rows plus one trust-boundary section.
Every row's source field was a category rather than a field: `command rows`,
`command credential`, `command connection string`, `command SQL`,
`command error`, `command session secret`, `command absolute path`,
`command stdout/stderr`.

Seven resolved to a named field with a file and a line, each one demonstrably
reaching the command's own stdout, stderr or on-disk input before the receipt is
written — which is what makes the row a real test rather than a payload nothing
ever carried:

| Row | Field |
| --- | --- |
| rows | `ReportFinding.rows` |
| credential | `ConnectionOptions.password` |
| connection string | `ConnectionOptions.uri` |
| SQL | `LintReport.sql` |
| error | `ConnectionError.message` |
| session secret | `ProxyEvent.sessionId` |
| absolute path | `DesignValidationError.filePath` |

**The eighth had no field, and that is a finding.** `command stdout/stderr`
implies a captured process output that feeds evidence receipts. There is none.
In the fixture, `PLAT007_UNBOUNDED_OUTPUT` is injected as another column of the
same diagnostic result that carries `PLAT007_ROW_SENTINEL`, so both flow through
`ReportFinding.rows` and are asserted absent from the same `rows-output.json`
receipt. The row is real and the payload is real; the label was describing a
mechanism that does not exist. It now names the field it actually uses, which
makes rows 1 and 8 share a source field and differ by payload — an honest
duplicate rather than an invented distinction.

The trust-boundary section had the same shape of problem in reverse. Its second
bullet, `Command inputs and outputs — may contain SQL, rows, paths, errors, or
secrets`, described a category and stated the guard as a prohibition. The guard
is structural: the receipt parser allows an exact key set, and
`buildEvidenceReceiptContext` populates `context` from four config-derived values
and two SHA-256 fingerprints. There is no field for a row, a credential, a
statement or an error body to occupy. The fourth bullet, `Receipt JSON`, named no
field either; it is the nine top-level keys the parser accepts on the way back
in.

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
* Reason: `security-declaration`

Eight security claims restated at once. Naming a field that sounds right and is
not is worse than the category it replaces, because it reads as verified.

## Scope

### In Scope

* Replacing the eight source-field cells with the fields named above.
* Rewriting the two prose bullets in `## Trust Boundary Fields` to name fields
  and state the structural guard.
* Deleting PLAT-007's entry from `PREDATING_FINDINGS`, which empties the map,
  and setting both counts to zero.
* Recording, in `scripts/lib/forgeflow-contract.ts`, that an empty list is the
  ratchet at its floor rather than a list that stopped mattering.

### Out of Scope

* Any change to `src/`, and any change to the payloads, expected results or
  persisted locations. The eight rows keep asserting what they asserted.
* Renaming row 8's payload or removing the row now that it shares a field with
  row 1. Both payloads are asserted; a row is not redundant because its
  neighbour enters the same way.
* Deleting `PREDATING_FINDINGS` or its counts now that they are empty. They are
  the check that keeps the floor.

## Inputs

* `src/core/evidence-receipt/index.ts`, `src/commands/evidence-receipt-context.ts`,
  `src/core/report/types.ts`, `src/core/lint/types.ts`, `src/adapters/types.ts`,
  `src/proxy/events.ts`, `src/core/design/index.ts`.
* `tests/integration/command-evidence-receipts.test.ts` — the cited fixture.

## Outputs

* A PLAT-007 Story upstream `story-check` reports no finding against.
* An empty exemption list: zero admitted findings across zero Stories.

## Rules

* R1: Every source-field cell names a field that exists and that the fixture's
  payload actually enters through.
* R2: Where no distinct field exists, the row says which field it shares rather
  than inventing one.
* R3: The trust-boundary bullets state the structural guard — an allowed key set
  and a `context` builder with four inputs — not a prohibition.
* R4: `ADMITTED_FINDINGS` and `ADMITTED_STORIES` reach zero, and the ratchet
  still fails on any finding.

## Expected Errors

* A source field naming something that does not exist passes the checker and
  fails R1; only reading the code catches it.
* Any finding at all now fails the gate, since nothing is admitted.

## Dependencies

* `scripts/lib/forgeflow-contract.ts` — the exemption list and its counts.
* DBCLI-022, DBCLI-023, DBCLI-024, DBCLI-025 — the first four removals.

## Constraints

* `bun run forgeflow:contract` is not in `make verify`; both must pass.
