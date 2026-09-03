# Acceptance Criteria

## Happy Path

* [x] `bun run forgeflow:check` runs adoption reconciliation and then handoff
      reconciliation, and both pass on the delivered tree.
* [x] The adoption gate prints one line naming the marker it read and the
      surfaces it agreed with, and exits 0.
* [x] `make verify` reaches `forgeflow:check` and passes.

## Business Rules

* [x] `specs/.forgeflow-adoption`, `specs/stories/README.md` and
      `specs/handoff.md` all resolve to ForgeFlow 0.3.2.
* [x] A well-formed marker parses to exactly `version` and `revision`; comments,
      blank lines and surrounding whitespace are tolerated.
* [x] The gate makes no network request and reads only repository files.
* [x] Handoff reconciliation still reports 12 completed Stories: 11 backed by a
      `Story:` commit trailer and DBCLI-001 backed by its recorded delivering
      commit.

## Failure Cases

Each exits non-zero and names file, locator, expected and actual.

* [x] Marker absent.
* [x] Marker missing `version`.
* [x] Marker missing `revision`.
* [x] Marker `version` not MAJOR.MINOR.PATCH.
* [x] Marker `revision` abbreviated rather than a full SHA.
* [x] Marker carrying an unrecognised key.
* [x] Marker declaring a key twice.
* [x] Marker line that is not `key=value`.
* [x] README declaring a different version.
* [x] README declaring a different revision.
* [x] README no longer declaring the adoption at all.
* [x] `specs/handoff.md` declaring an older adopted version.
* [x] Story template declaring a different version.
* [x] Local `story-development` Skill declaring a different version.
* [x] A reconciled adoption surface deleted.
* [x] When the marker itself is unparseable, only the marker is reported — the
      other surfaces are not compared against half an answer.

## Regression Requirements

* [x] A historical version written away from the word `ForgeFlow` — the
      README's `first adopted at 0.3.0`, the handoff's `0.3.1 新增上游的
      story-check` and `升級到 0.3.1 時` — is not reported.
* [x] A marker checked out with CRLF line endings parses.
* [x] A canonical README declaration wrapped across a line break is accepted.
* [x] Every emitted message names a locatable place and both values, and
      contains none of `unknown`, `invalid`, `something`, `somewhere`.
* [x] One test reconciles the real working tree read-only, so fixture-only
      coverage cannot hide live drift.

## Verification Notes

Focused: `bun test tests/contract/forgeflow-adoption.test.ts` and
`bun run forgeflow:check`.

Gate: `make verify` from the repository root. Its `test` step requires the
docker-compose test services; a run without Docker is not a PASS and must be
reported as such rather than described as passing.
