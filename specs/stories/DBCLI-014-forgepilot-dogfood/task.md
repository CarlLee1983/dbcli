# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [x] Ignore `.forgepilot/` and confirm with `git check-ignore`.
* [x] Prepend a lockfile-pinned install step to `make verify`.
* [x] Prove the clean-checkout claim by running `make verify` in a detached
      worktree that has no `node_modules`.
* [x] Add the short workflow ordering to `AGENTS.md` without restating
      ForgePilot's documentation.
* [x] Record the delivery in `specs/handoff.md`.

## Notes

* ForgePilot's `verify` builds its worktree under `.forgepilot/worktrees/`, so
  the install step runs against a checkout inside the ignored directory.
* The integration services are reached over host ports, so a fresh worktree
  needs no service bootstrap of its own.
