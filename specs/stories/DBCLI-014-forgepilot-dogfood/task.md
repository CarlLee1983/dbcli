# Implementation Progress

This optional file tracks execution progress. Product requirements belong in
`story.md` and `acceptance.md`.

## Plan

* [ ] Ignore `.forgepilot/` and confirm with `git check-ignore`.
* [ ] Prepend a lockfile-pinned install step to `make verify`.
* [ ] Prove the clean-checkout claim by running `make verify` in a detached
      worktree that has no `node_modules`.
* [ ] Add the short workflow ordering to `AGENTS.md` without restating
      ForgePilot's documentation.
* [ ] Record the delivery in `specs/handoff.md`.

## Notes

* ForgePilot's `verify` builds its worktree under `.forgepilot/worktrees/`, so
  the install step runs against a checkout inside the ignored directory.
* The integration services are reached over host ports, so a fresh worktree
  needs no service bootstrap of its own.
