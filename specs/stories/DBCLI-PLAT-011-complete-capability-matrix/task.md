# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [x] Audit the sixteen uncovered commands against the code, one cited
      `file:line` per claim. Four subagents were dispatched in parallel and none
      returned a usable report, so every row was read directly — recorded in the
      Story's Delegation note.
* [x] Derive the JSON surface from the live Commander tree rather than from
      `--help` prose, so `supportsJson` is a measurement.
* [x] Extend `ENGINE_CAPABILITIES` with 19 keys and one shared
      `SQL_ONLY_UNSUPPORTED` block for the three non-SQL engines.
* [x] Declare the capabilities in the registry; let the contract test correct
      the audit where it can.
* [x] Populate `COMMAND_SURFACE.evidenceCommands`, previously empty.
* [x] ADR-0023 on whether the catalog describes itself.
* [x] Documentation: the reference's scope paragraph, its five mirrors, both
      user-doc locales in both formats, and a parity test that fails if the
      paragraph goes stale again.
* [x] `make verify`.

## Notes

Two things the contract test caught that reading code did not, both recorded in
the Story's Superseded Behavior:

* `commandWritesConfig` resolved `commands/<name>.ts` and **skipped on a miss**,
  so `password` (`credential.ts`) was never checked and "writes no
  configuration" came back true for the credential command.
* `impact assess` and `design` failed their offline claim because they import
  ORM-artifact helpers from `commands/diff.ts`, dragging its adapter imports
  into their graph. The helpers moved to `src/core/orm-drift/input.ts` — no
  behaviour change, and the claim becomes provable rather than exempted.

The first evidence-parity attempt derived "writes evidence" from import-graph
reachability and matched seventeen commands that only pull the receipt types in
transitively. Reaching a module is not writing one; the check is the writer call
in the command layer.

`docker compose -f docker-compose.test.yml up -d --wait` before `make verify`.
