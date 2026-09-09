# Acceptance Criteria

## Happy Path

* [x] Upstream `story-check` at the adopted revision `cb4bc976` reports no
      `FAIL` line for `specs/stories/DBCLI-PLAT-004-operation-envelope-v1` —
      `FORGEFLOW_ROOT=<checkout> bun run forgeflow:contract`
* [x] `bun run forgeflow:contract` passes and its banner reads 20 admitted
      pre-existing findings, down from 21 — same command

## Business Rules

* [x] Every bullet under PLAT-004's `## Trust Boundary Fields` carries a
      non-empty backticked span, which is the rule
      `forgeflow_count_literal_bullets` and `forgeflow_has_literal` enforce —
      upstream `story-check`
* [x] Each declared field is one the code at this revision actually accepts or
      emits, named at `src/core/operation-envelope.ts`,
      `src/utils/agent-output.ts`, `src/commands/capabilities.ts`, or
      `src/commands/capability-context.ts` — human review against those files
* [x] The section separates the values dbcli derives from `argv`, the
      environment and `config.json` from the values
      `parseOperationEnvelope(unknown)` accepts from an external producer —
      human review
* [x] The 65,536-byte cap and single-document framing removed from the section
      remain stated as R12, R13 and R14 — human review of the same file
* [x] `PREDATING_FINDINGS` holds no entry for
      `DBCLI-PLAT-004-operation-envelope-v1`, and the four remaining entries
      are unchanged in name and content —
      `tests/unit/scripts/forgeflow-contract.test.ts`
* [x] `ADMITTED_FINDINGS` is 20 and `ADMITTED_STORIES` is 4, and both equal what
      `PREDATING_FINDINGS` holds — same file
* [x] No duplicate finding is admitted within any remaining Story — same file

## Failure Cases

* [x] A finding upstream reports for a Story with no exemption fails the gate as
      unadmitted, so deleting the entry while the prose remains cannot pass —
      `tests/unit/scripts/forgeflow-contract.test.ts`
* [x] An exemption entry upstream no longer reports fails the gate as a stale
      entry that must be deleted — same file
* [x] `ADMITTED_FINDINGS` or `ADMITTED_STORIES` left at the old value fails
      before the gate runs — same file
* [x] A ForgeFlow checkout at another revision, or with uncommitted changes, is
      refused rather than run — same file

## Regression Requirements

* [x] `src/` is unchanged by this Story, so no product behavior, output byte, or
      exit code moves — `git diff --stat` against the baseline commit
* [x] The other four admitted Stories keep exactly the findings they had —
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
worktree. `forgeflow:contract` is deliberately not a `make verify` step — it
needs a ForgeFlow checkout and `make verify` must run from a clone of this
repository alone — so passing one is not evidence about the other and both are
required.
