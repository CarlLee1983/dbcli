# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [x] Upgrade through `./scripts/bootstrap --upgrade` from a v0.7.0 checkout.
* [x] Pin the marker to the tag and bring every restatement surface along.
* [x] `git mv` all 28 records and update the path references.
* [x] Add the reference test.
* [x] Set `FORGEFLOW_DECISIONS_ROOT` in the contract check.
* [x] Record the rename decision as ADR-0029 and declare it in this Story.
* [x] Move every record's status out of front matter — found mid-flight.

## Notes

* Measured 2026-09-09: 21 findings under v0.6.0 and the same 21 under v0.7.0.
* `FORGEFLOW_DECISIONS_ROOT=docs/adr` alone still fails: the lookup is
  `<root>/ADR-<digits>.md` or `<root>/ADR-<digits>-*.md`, and referring to a
  record as `0028` fails the id grammar instead.

### The second half of the mismatch, found mid-flight

Setting the root and renaming the files was not enough. Upstream also reads the
record's status as a `* Status: <value>` bullet in the body:

```
DBCLI-021-resolvable-decision-records: referenced decision must declare Status exactly once: ADR-0029
```

All 29 records declared it in YAML front matter instead. Carrying both would
have put two statuses in one file, which is the drift this repository's gates
exist to catch, so the front matter was converted: `status`/`date` and the four
records' extra fields (`accepted`, `dogfooded`, `amends`, `superseded_by`,
`reopen_trigger`) are now bullets under the title. `amends: 0012` and
`superseded_by: 0012` became `ADR-0012`, since that is what the record is called
now.

### What the rename nearly broke

Four relative links *between* records — `](0012-known-defects-....md)` — carry no
`docs/adr/` prefix, so the sweep that fixed the 34 prefixed references did not
see them. They were caught by reading the two superseded records, not by a
check. `tests/unit/build/adr-references.test.ts` now covers both link shapes and
the Status declaration.

### Evidence

* `bun run forgeflow:contract` against `cb4bc976`: `29 Stories, 21 admitted
  pre-existing finding(s), handoff contract OK` — the same 21 as under 0.6.0.
* Negative test: with `ADR-0029-*.md` moved away, the same command reports
  `referenced decision record does not exist: ADR-0029`.
* `bun run forgeflow:check`: passes, all six adoption surfaces agree on 0.7.0.
