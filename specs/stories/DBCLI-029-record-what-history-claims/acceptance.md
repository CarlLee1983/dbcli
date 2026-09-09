# Acceptance Criteria

## Happy Path

* [ ] AC-001: A Story whose `Story:` trailer is reachable from `HEAD` and which
      has a `specs/stories` directory, but which `completed_stories` does not
      record, fails by name with a message saying to record it.
* [ ] AC-002: `bun run forgeflow:check` passes on this branch with no edit to
      `completed_stories` beyond DBCLI-029's own entry.

## Business Rules

* [ ] AC-003: A trailer naming a Story with no `specs/stories` directory is not
      reported, so the issue-accepted `DBCLI-PLAT-008` does not demand an entry.
* [ ] AC-004: Both directions read one set of trailers, so a Story recorded and
      delivered, and a Story delivered and unrecorded, are decided against the
      same history.
* [ ] AC-005: A Story with a directory and no trailer anywhere is not reported
      by the reverse rule — an authored, undelivered Story is not a delivery.

## Failure Cases

* [ ] AC-006: The forward rules still fail: a recorded Story with no trailer and
      no exemption, a stale exemption, an exemption naming an absent commit, and
      a recorded Story with no directory.
* [ ] AC-007: A shallow clone is refused before either direction runs.

## Regression Requirements

* [ ] AC-008: `src/` is unchanged.
* [ ] AC-009: `PREDATING_FINDINGS` is still empty and both admitted counts are
      still zero.
* [ ] AC-010: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `a trailer for a Story absent from completed_stories` | `one failure naming the Story` |
| `AC-002` | command | `bun run forgeflow:check` | `this branch` | `reconciliation passed` |
| `AC-003` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `a trailer whose Story has no directory` | `no failure` |
| `AC-004` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `one trailer set, both directions` | `both verdicts from the same input` |
| `AC-005` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `a Story directory with no trailer` | `no reverse failure` |
| `AC-006` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `the existing reconcile fixtures` | `each failure names its Story` |
| `AC-007` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `git rev-parse --is-shallow-repository answering true` | `refusal naming --unshallow` |
| `AC-008` | command | `git diff --stat 2594c2c6 -- src` | `repository checkout` | `empty output` |
| `AC-009` | command | `bun run forgeflow:contract` | `FORGEFLOW_ROOT at cb4bc976` | `0 admitted pre-existing finding(s)` |
| `AC-010` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/unit/scripts/forgeflow-handoff.test.ts
bun run forgeflow:check
FORGEFLOW_ROOT=<clean ForgeFlowV2 checkout> bun run forgeflow:contract
make verify
```

What human review should weigh is the timing in ADR-0032: the entry is written
in the change that delivers the Story, so the gate is green at every commit that
carries the trailer. The alternative — recording after the merge — is what left
two Stories unrecorded, and it makes `main` red between the merge and the
follow-up.
