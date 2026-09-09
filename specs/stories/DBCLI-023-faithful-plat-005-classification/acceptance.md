# Acceptance Criteria

## Happy Path

* [x] Upstream `story-check` at the adopted revision `cb4bc976` reports no
      `FAIL` line for `specs/stories/DBCLI-PLAT-005-agent-json-mode` —
      `FORGEFLOW_ROOT=<checkout> bun run forgeflow:contract`
* [x] `bun run forgeflow:contract` passes and its banner reads 18 admitted
      pre-existing findings, down from 20 — same command

## Business Rules

* [x] PLAT-005 declares `Baseline conformance: yes`, and its
      `## Superseded Behavior` entries are unchanged from what was accepted —
      `git diff` of that file against the baseline commit
* [x] Every bullet under PLAT-005's `## Trust Boundary Fields` carries a
      non-empty backticked span — upstream `story-check`
* [x] The catalog path reads no environment variable, file or dynamic import:
      every file the `src/core/capabilities/` import graph reaches is asserted
      free of `process.env`, `Bun.file(`, `node:fs` and `import(`, which is what
      lets `capabilities.list` emit `context: null` —
      `tests/contract/capability-contract.test.ts`
* [x] A successful `capabilities.list` envelope with a non-null `context`, or a
      populated `warnings`, `evidence` or `recovery`, is rejected by the parser —
      `tests/unit/core/operation-envelope.test.ts`
* [x] `PREDATING_FINDINGS` holds no entry for
      `DBCLI-PLAT-005-agent-json-mode`, and the three remaining entries are
      unchanged in name and content —
      `tests/unit/scripts/forgeflow-contract.test.ts`
* [x] `ADMITTED_FINDINGS` is 18 and `ADMITTED_STORIES` is 3, and both equal what
      `PREDATING_FINDINGS` holds — same file
* [x] What remains is 16 security-fixture-cell findings and 2 trust-boundary
      findings, with no Classification contradiction left — same file

## Failure Cases

* [x] A finding upstream reports for a Story with no exemption fails the gate as
      unadmitted, so deleting the entry while the contradiction remains cannot
      pass — `tests/unit/scripts/forgeflow-contract.test.ts`
* [x] An exemption entry upstream no longer reports fails the gate as a stale
      entry that must be deleted — same file
* [x] `ADMITTED_FINDINGS` or `ADMITTED_STORIES` left at the old value fails
      before the gate runs — same file

## Regression Requirements

* [x] `src/` is unchanged by this Story, so no product behavior, output byte, or
      exit code moves — `git diff --stat` against the baseline commit
* [x] The three remaining admitted Stories keep exactly the findings they had —
      `bun run forgeflow:contract`
* [x] The complete repository verification gate passes — `make verify`

## Verification Notes

Run the focused contract checks first:

```sh
bun test tests/unit/scripts/forgeflow-contract.test.ts
```

Then, from a clean ForgeFlow checkout at exactly `cb4bc976`:

```sh
FORGEFLOW_ROOT=<checkout> bun run forgeflow:contract
```

Then run `make verify` from the repository root against a clean, committed
worktree. `forgeflow:contract` is deliberately not a `make verify` step, so
passing one is not evidence about the other and both are required.

The Classification correction is the item human review should weigh: the
alternative exit — deleting `## Superseded Behavior` — satisfies the same
checker and loses the record of what PLAT-005 replaced.
