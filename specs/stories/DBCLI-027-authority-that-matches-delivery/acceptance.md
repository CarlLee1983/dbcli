# Acceptance Criteria

## Happy Path

* [x] `bun run forgeflow:check` passes, reconciling 34 completed Stories —
      `bun run forgeflow:check`
* [x] No Story declaring `## Authority` declares `commit: no` or `push: no` —
      `grep -c '^\* \(commit\|push\): no' specs/stories/DBCLI-*/story.md`

## Business Rules

* [x] A completed Story declaring `commit: no` and `push: no` produces exactly
      two failures, one naming each permission —
      `tests/unit/scripts/forgeflow-handoff.test.ts`
* [x] A Story with no `## Authority` section declares nothing and is not
      reported — same file
* [x] A permission absent from a declared section is not read as `no` — same file
* [x] A Story absent from `completed_stories` is not checked, so an in-flight
      Story may truthfully declare `push: no` — same file
* [x] `deploy: no` on a delivered Story is left alone; only `commit` and `push`
      are checked — same file
* [x] DBCLI-022 to DBCLI-026 are recorded in `completed_stories`, each backed by
      its own `Story:` commit trailer — `bun run forgeflow:check`

## Failure Cases

* [x] Before this Story's corrections, the gate reported DBCLI-019, DBCLI-020 and
      DBCLI-021 by name for `commit: no` — reproduced in-session against the
      pre-correction tree
* [x] The gate reads `specs/handoff.md` and the Story files only, spawning no
      git command, so a shallow clone cannot change its verdict — human review of
      `scripts/lib/forgeflow-handoff.ts`

## Regression Requirements

* [x] `src/` is unchanged — `git diff --stat` against the baseline commit
* [x] The existing handoff reconciliation is unchanged: delivery claims are still
      checked against `Story:` trailers and `DELIVERED_BEFORE_TRAILERS` —
      `tests/unit/scripts/forgeflow-handoff.test.ts`
* [x] `docs/adr/` still declares no record as `proposed` —
      `tests/unit/build/adr-references.test.ts`
* [x] The complete repository verification gate passes — `make verify`

## Verification Notes

```sh
bun test tests/unit/scripts/forgeflow-handoff.test.ts tests/unit/build/adr-references.test.ts
bun run forgeflow:check
```

The correction of eight approved declarations is what human review should weigh.
It rests on the measurement in ADR-0030 — eight of eight declared `push: no`
while all eight were delivered — and not on the declarations being untidy. If
that measurement is wrong, the edit is the quiet record change this repository
normally refuses.
