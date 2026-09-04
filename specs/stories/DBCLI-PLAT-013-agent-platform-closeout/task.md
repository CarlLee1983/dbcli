# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [x] Failing tests first: `tests/unit/scripts/forgeflow-handoff.test.ts` over
      fixtures, and the ordering parity test in `tests/docs/`.
* [x] Extract `scripts/lib/forgeflow-handoff.ts` — lifecycle parsing, Story ID
      reading, reconciliation — mirroring the adoption gate's lib/shell split.
* [x] Reduce `scripts/check-forgeflow-handoff.ts` to the git and filesystem
      shell.
* [x] Correct the ordering claim in PLAT-001 `story.md` R5 and `acceptance.md`.
* [x] State the ordering contract positively in the design record,
      `assets/reference.md`, both user-doc locales, both formats, and the
      generated platform mirrors.
* [x] Rewrite `specs/handoff.md`: PLAT-001 completed, PLAT-013 current,
      PLAT-012 next, real baseline and verification.
* [x] `make verify`.

## Notes

* The capability code is not touched. Every ordering statement moves toward the
  behaviour the tests already assert, never the reverse.
* `docker compose -f docker-compose.test.yml up -d --wait` before `make verify`.
