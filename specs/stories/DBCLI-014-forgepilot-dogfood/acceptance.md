# Acceptance Criteria

## Happy Path

* [ ] `forgepilot init` in the dbcli repository root creates `.forgepilot/`
      containing a state snapshot.
* [ ] This Story can be added to a ForgePilot Goal as a Work Item that
      references `specs/stories/DBCLI-014-forgepilot-dogfood`.
* [ ] `forgepilot next` deterministically selects that Work Item while it is the
      only READY one.
* [ ] `forgepilot start <work-id>` moves it to RUNNING, and `forgepilot status`
      still reports RUNNING after the process exits.
* [ ] With the worktree clean, `forgepilot verify <work-id>` runs dbcli's own
      `make verify` in a detached worktree of the resolved commit.
* [ ] The recorded evidence names the exact commit SHA that was verified.
* [ ] A PASS moves the Work Item to REVIEW.
* [ ] `forgepilot review approve <work-id>` with the conditions satisfied moves
      the Work Item to DONE.

## Business Rules

* [ ] `make verify` runs to completion from a checkout that contains no
      `node_modules`, installing the dependency set pinned by `bun.lock` first.
* [ ] The list of steps in `make verify` after this Story is the list before it
      plus the install step, with nothing removed and nothing reordered.
* [ ] `.forgepilot/` is matched by `.gitignore`, verified with
      `git check-ignore .forgepilot/state.json`.
* [ ] Neither `package.json` dependencies nor any file under `src/` mentions
      ForgePilot.
* [ ] `specs/.forgeflow-adoption`, `specs/stories/_template/`, and the Story
      contract enforced by `bun run forgeflow:check` are unchanged.

## Failure Cases

* [ ] `forgepilot verify` is refused while the worktree is dirty, including
      untracked files, and no evidence is recorded for that attempt.
* [ ] An unresolved Gate on a Work Item blocks `verify` and excludes the item
      from `forgepilot next`, without changing the item's own status.
* [ ] Resolving that Gate lets the workflow continue.

## Regression Requirements

* [ ] `make verify` passes on the delivered commit.
* [ ] Evidence recorded against an earlier revision is retained but reported as
      no longer applying once HEAD moves to a later commit.
* [ ] No already-delivered Story is re-entered into the ForgePilot queue, and
      `specs/handoff.md`'s `completed_stories` continues to reconcile under
      `bun run forgeflow:check`.

## Verification Notes

The evidence for the workflow criteria is the ForgePilot state snapshot under
`.forgepilot/`, which is deliberately not committed; the delivery report records
the Work Item ID, the commit SHA, and the evidence ID it produced.

The install step is the only change to `make verify`. Confirm it from a checkout
with no `node_modules` — a run on a developer machine that already installed
them proves nothing about the clean case.
