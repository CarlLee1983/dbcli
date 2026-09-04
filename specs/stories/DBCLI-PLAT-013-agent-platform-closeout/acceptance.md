# Acceptance Criteria

## Happy Path

* [x] The gate reconciles a numeric Story (`DBCLI-001`) recorded as completed —
      `tests/unit/scripts/forgeflow-handoff.test.ts`
* [x] The gate reconciles a PLAT Story (`DBCLI-PLAT-001`) recorded as completed,
      reading its ID from the `story.md` heading — same file
* [x] `bun run scripts/check-forgeflow-handoff.ts` passes against this
      repository with `DBCLI-PLAT-001` in `completed_stories` — `make verify`

## Business Rules

* [x] A Story ID comes from `# Story: <ID>` in `story.md`, and no ID shape is
      hard-coded — `tests/unit/scripts/forgeflow-handoff.test.ts`
* [x] `DELIVERED_BEFORE_TRAILERS` remains a ratchet: an entry for a Story that
      has since acquired a trailer fails, and so does one naming a commit the
      repository does not contain — same file
* [x] The gate reaches no network: its only inputs are the handoff text, the
      Story headings, the trailer set and a commit-existence predicate, all
      injected, and the module imports nothing at all — same file
* [x] `required` and `results` preserve first-seen input order, and argument
      order changes neither any verdict nor `ok` —
      `tests/unit/core/capabilities/check.test.ts`
* [x] Identical input produces byte-identical output — same file

## Failure Cases

* [x] A completed Story with no `specs/stories` directory fails closed —
      `tests/unit/scripts/forgeflow-handoff.test.ts`
* [x] A completed Story with neither a `Story:` trailer nor an exemption fails
      closed — same file
* [x] A Story recorded as both `current_story` and `completed_stories` fails
      closed — same file
* [x] A `current_story` with no directory fails closed — same file
* [x] A shallow clone is refused with an actionable message rather than skipped
      — same file
* [x] A handoff with no lifecycle block, and one whose lifecycle block records
      no `completed_stories`, are both refused — same file
* [x] A `story.md` with no `# Story:` heading is refused, naming the file —
      same file
* [x] Two directories declaring the same Story ID are refused, naming both —
      same file

## Regression Requirements

* [x] `check-forgeflow-adoption.ts` is unchanged and still passes — `make verify`
* [x] `capabilities check` output is unchanged: no source file under
      `src/core/capabilities/` or `src/commands/capabilities.ts` is modified by
      this Story — `git diff --stat`, and the existing capability suites still
      pass unchanged in assertion count
* [x] Every surface that describes `--require` ordering says the same thing —
      `tests/docs/capability-ordering-parity.test.ts`
* [x] `make verify` passes in full

## Verification Notes

The gate's tests run against fixtures, never against the live repository: a test
that read `specs/handoff.md` would pass or fail for reasons the test does not
control, and would have to be rewritten every time a Story is delivered.

`make verify` requires the integration services from `docker-compose.test.yml`;
`bun run services:check` refuses to proceed without them.
